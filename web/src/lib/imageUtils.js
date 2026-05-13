/**
 * imageUtils — client-side image processing helpers.
 *
 * Right now the only export is `downscaleImage`, used by the signup
 * flow to keep avatars small (~50-100 KB) regardless of how big the
 * user's source photo is. This matters at scale: a 10 MB phone photo
 * × 1000 clients = 10 GB; a 100 KB downscaled avatar × 1000 clients
 * = 100 MB. Storage is the constraint, not bandwidth, so we resize
 * once on the client before upload.
 *
 * All processing happens in a hidden <canvas>, so it works on every
 * modern browser without any third-party library or server round
 * trip. Animated GIFs become single frames (canvas only sees frame 0)
 * which is the desired behavior for avatars anyway.
 *
 * Limitations:
 *   • HEIC / HEIF (default iPhone format) doesn't decode in canvas
 *     on most browsers — the caller should mime-filter it out before
 *     calling this function and tell the user to pick JPG/PNG/WEBP.
 *   • Very large source images (> ~50 MP) may run out of canvas
 *     memory on low-end devices. The caller should cap the picker
 *     file size (e.g. 10 MB) — that's well below the canvas limit
 *     for any image you'd actually want to upload.
 */

/**
 * Loads a File / Blob into a fully-decoded HTMLImageElement.
 * Wrapped in a Promise so the caller can await it cleanly.
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url) // release the Blob now that the bitmap is decoded
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}

/**
 * Downscale an image File/Blob to fit within `maxDim` × `maxDim`,
 * preserving aspect ratio, and re-encode as JPEG at the given quality.
 *
 * Returns a Blob of the encoded JPEG. The caller can pass this Blob
 * directly to supabase.storage.upload() — no extension juggling, just
 * set contentType: 'image/jpeg'.
 *
 * Defaults are tuned for profile avatars (512 px is plenty for a 64×64
 * UI avatar even on retina; 0.85 quality is the sweet spot where JPEG
 * artifacts are invisible to the human eye but file size collapses).
 *
 * Images smaller than maxDim are not enlarged — we just re-encode them.
 */
export async function downscaleImage(file, opts = {}) {
  const { maxDim = 512, quality = 0.85, mimeType = 'image/jpeg' } = opts
  const img = await loadImage(file)

  // Math.min(1, ...) prevents upscaling a small source: a 100×100
  // input stays 100×100 rather than blurring up to 512×512.
  const ratio = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * ratio))
  const h = Math.max(1, Math.round(img.height * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot process images here.')

  // White fill before drawImage so JPEG (which has no alpha channel)
  // doesn't render transparent PNGs as black. Harmless for opaque
  // sources — they just paint over the white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error('Could not encode that image.')),
      mimeType,
      quality,
    )
  })
}

/**
 * Crop a region out of an image File/Blob and re-encode the result as a
 * `size × size` JPEG. Used by the avatar cropper so the user's chosen
 * focal area (face, etc.) is what lands in storage — not the center
 * crop of whatever portrait/landscape photo they happened to pick.
 *
 * `area` is the raw-pixel rectangle returned by react-easy-crop's
 * `onCropComplete` callback (its second argument, `croppedAreaPixels`).
 * It's expressed in source-image coordinates, not display coordinates,
 * so we can pipe it straight into `drawImage`'s 9-arg form.
 *
 * Why force a square output:
 *   • Avatars are always rendered in round containers; aspect = 1 is
 *     the only sensible target.
 *   • A fixed 512×512 output keeps storage usage predictable
 *     (~50-100 KB at quality 0.85 regardless of source).
 *
 * The white fill mirrors `downscaleImage`: JPEG has no alpha, so any
 * transparent area in the cropped region (PNGs with cutouts) gets a
 * white background instead of black.
 */
export async function cropAndDownscale(file, area, opts = {}) {
  const { size = 512, quality = 0.85, mimeType = 'image/jpeg' } = opts
  if (!area || area.width <= 0 || area.height <= 0) {
    throw new Error('Invalid crop area.')
  }
  const img = await loadImage(file)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot process images here.')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  // 9-arg drawImage: pull a rectangle from the source (sx, sy, sw, sh)
  // and paint it scaled into the destination (0, 0, size, size).
  ctx.drawImage(
    img,
    area.x, area.y, area.width, area.height,
    0,      0,      size,       size,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error('Could not encode that image.')),
      mimeType,
      quality,
    )
  })
}
