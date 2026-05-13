/**
 * Place high-res logos with TRANSPARENT backgrounds and consistent sizing.
 *
 * Source:
 *   MyRX/Logo/logo 1.png   — full logo, light theme (black "My" + lime "RX" + black "Performance Lab")
 *   MyRX/Logo/Logo 2.png   — full logo, dark theme  (white "My" + lime "RX" + white "Performance Lab")
 *   MyRX/Logo/Logo 3.png   — stacked "MyRX" wordmark (white "My" above lime "RX")
 *
 * Strategy:
 *   – Full logos (Navbar, Landing): trim each source to its OPAQUE content bbox,
 *     then re-canvas both at the SAME normalized dimensions so light + dark
 *     render at identical visible size (the source files have asymmetric
 *     transparent padding, which made the "size" of the logo look different
 *     between themes even though the content was nearly identical).
 *   – Icons (favicon, PWA, mobile): extract JUST the lime "RX" pixels from
 *     Logo 3 by colour detection. Using the full stacked wordmark caused the
 *     white "My" to disappear on light surfaces (browser tabs, iOS home
 *     screen with light wallpaper). RX alone works on every background.
 *   – ALL outputs use a transparent PNG background.
 */

const sharp = require('sharp')
const fs    = require('fs')
const path  = require('path')

const WEB_ROOT    = path.resolve(__dirname, '..')                                // MyRX/
const MOBILE_ROOT = path.resolve(__dirname, '..', '..', 'MyRX-Mobile')           // MyRX-Mobile/

const SRC = {
  logo1: path.join(WEB_ROOT, 'Logo', 'logo 1.png'),
  logo2: path.join(WEB_ROOT, 'Logo', 'Logo 2.png'),
  logo3: path.join(WEB_ROOT, 'Logo', 'Logo 3.png'),
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

// ── Pixel-level helpers ──────────────────────────────────────────────────────

/** Bounding box of all pixels with alpha > 50. */
async function opaqueBBox(input) {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let minX=width, maxX=0, minY=height, maxY=0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y*width+x)*channels + 3]
      if (a > 50) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  return { left: minX, top: minY, width: maxX-minX+1, height: maxY-minY+1 }
}

/**
 * Bounding box of lime-green pixels (the "RX" colour ≈ rgb(200, 240, 55)).
 * Used to extract just RX from Logo 3, which contains both white "My" and
 * lime "RX". White "My" pixels (R≈G≈B) are excluded by the chroma check.
 */
async function limeBBox(input) {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let minX=width, maxX=0, minY=height, maxY=0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y*width+x)*channels
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3]
      // Lime: green dominates, blue is low, alpha is opaque.
      // White text fails this because white has R≈G≈B (high) — both R and G
      // are high but blue is also high, so b < 130 cuts white out.
      if (a > 50 && g > 180 && b < 130 && r > 80) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  return { left: minX, top: minY, width: maxX-minX+1, height: maxY-minY+1 }
}

// ── Run ───────────────────────────────────────────────────────────────────────

;(async () => {
  // ── 1. Trim + normalize full logos ──────────────────────────────────────────
  console.log('▶ Full logos (Navbar + Landing) — trim + normalize for size parity')

  const bbox1 = await opaqueBBox(SRC.logo1)
  const bbox2 = await opaqueBBox(SRC.logo2)
  console.log(`  Logo 1 content: ${bbox1.width}×${bbox1.height}`)
  console.log(`  Logo 2 content: ${bbox2.width}×${bbox2.height}`)

  // Use the LARGER of the two bboxes for the common canvas, so neither logo
  // gets cropped. The smaller one will have a tiny transparent margin (a few
  // pixels) — invisible at any rendered size. Both end up rendering at the
  // identical pixel size in the Navbar.
  const W = Math.max(bbox1.width, bbox2.width)
  const H = Math.max(bbox1.height, bbox2.height)
  console.log(`  Normalized canvas: ${W}×${H} (aspect ${(W/H).toFixed(2)}:1)`)

  for (const [src, bbox, name] of [
    [SRC.logo1, bbox1, 'logo-light.png'],
    [SRC.logo2, bbox2, 'logo-dark.png'],
  ]) {
    const trimmed = await sharp(src).extract(bbox).toBuffer()
    const dest = path.join(WEB_ROOT, 'public', name)
    await sharp({ create: { width: W, height: H, channels: 4, background: TRANSPARENT } })
      .composite([{ input: trimmed, gravity: 'center' }])
      .png()
      .toFile(dest)
    console.log(`  ✓ ${path.relative(process.cwd(), dest)}`)
  }

  // ── 2. Extract just lime RX from Logo 3 ─────────────────────────────────────
  console.log('\n▶ Extracting just lime RX from Logo 3')

  const limeBB = await limeBBox(SRC.logo3)
  console.log(`  Lime-RX bbox: ${limeBB.width}×${limeBB.height} at (${limeBB.left}, ${limeBB.top})`)
  const rxOnly = await sharp(SRC.logo3).extract(limeBB).toBuffer()

  /**
   * Render the RX mark onto a square canvas of `size` × `size` with transparent
   * bg and `padPct` empty space around the mark.
   *  - paddingPct: 0.10 = mark fills inner 80% (favicon / web)
   *                0.22 = inner 56% (Android adaptive — needs safe-area margin)
   *                0.30 = inner 40% (splash — wide breathing room)
   */
  async function rxIcon({ size, paddingPct, dest }) {
    const inner = Math.round(size * (1 - paddingPct * 2))
    const resized = await sharp(rxOnly)
      .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
      .toBuffer()
    await sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
      .composite([{ input: resized, gravity: 'center' }])
      .png()
      .toFile(dest)
    console.log(`  ✓ ${path.relative(process.cwd(), dest)} (${size}×${size}, pad ${Math.round(paddingPct*100)}%)`)
  }

  // ── 3. Web favicon + PWA icons (all transparent) ───────────────────────────
  console.log('\n▶ Web favicon + PWA icons (all transparent bg)')
  await rxIcon({ size: 1024, paddingPct: 0.10, dest: path.join(WEB_ROOT, 'public', 'logo-icon.png') })
  await rxIcon({ size:  192, paddingPct: 0.10, dest: path.join(WEB_ROOT, 'public', 'icon-192.png') })
  await rxIcon({ size:  512, paddingPct: 0.10, dest: path.join(WEB_ROOT, 'public', 'icon-512.png') })

  // ── 4. Mobile assets (all transparent) ──────────────────────────────────────
  console.log('\n▶ Mobile assets (all transparent bg)')
  await rxIcon({ size: 1024, paddingPct: 0.15, dest: path.join(MOBILE_ROOT, 'assets', 'icon.png') })
  await rxIcon({ size: 1024, paddingPct: 0.22, dest: path.join(MOBILE_ROOT, 'assets', 'adaptive-icon.png') })
  await rxIcon({ size: 1024, paddingPct: 0.30, dest: path.join(MOBILE_ROOT, 'assets', 'splash-icon.png') })
  await rxIcon({ size:   48, paddingPct: 0.10, dest: path.join(MOBILE_ROOT, 'assets', 'favicon.png') })

  // ── 5. Mobile in-app top-bar logo ───────────────────────────────────────────
  // Use the normalized logo-dark (matches web Navbar's dark-theme branch).
  fs.copyFileSync(
    path.join(WEB_ROOT, 'public', 'logo-dark.png'),
    path.join(MOBILE_ROOT, 'assets', 'logo-dark.png'),
  )
  console.log('\n▶ Mobile top-bar logo')
  console.log(`  ✓ ${path.relative(process.cwd(), path.join(MOBILE_ROOT, 'assets', 'logo-dark.png'))} (copy of normalized logo-dark.png — aspect ${(W/H).toFixed(2)}:1)`)

  console.log(`\n  ⚠  Update mobile logoImg style aspect to ${(W/H).toFixed(2)}:1`)
  console.log('     (e.g. width: 32 * ' + (W/H).toFixed(2) + ' = ' + Math.round(32 * W/H) + ')')

  console.log('\n✓ Done.')
})().catch(err => { console.error(err); process.exit(1) })
