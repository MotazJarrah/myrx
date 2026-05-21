/**
 * BarcodeScanner
 * Full-screen camera overlay using @zxing/browser.
 * Calls onScan(rawText) on first read, onClose() on dismiss.
 *
 * Camera selection: requests the REAR camera explicitly via
 * facingMode='environment'. The previous version passed `undefined` as
 * the deviceId which lets the browser pick — on phones this defaults
 * to the FRONT camera, which is useless for scanning a barcode the
 * user is holding in front of them.
 *
 * Format hints: only scans UPC/EAN families (what every food product
 * barcode uses — UPC-A, UPC-E, EAN-13, EAN-8). Drops QR codes, Code
 * 128, Data Matrix, etc. that the reader would otherwise try every
 * frame. Big perf + reliability win on slower phones.
 */

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { X, Camera } from 'lucide-react'

// Pre-build the hints map once — only the four barcode formats found on
// retail food packaging. Excluding QR/Data Matrix/Code 128 makes each
// decode pass faster and reduces false positives on busy packaging.
const SCAN_HINTS = new Map()
SCAN_HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
])
SCAN_HINTS.set(DecodeHintType.TRY_HARDER, true)

export function BarcodeScanner({ onScan, onClose }) {
  const videoRef    = useRef(null)
  const controlsRef = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(SCAN_HINTS)
    let stopped  = false

    // ── Lock screen orientation to portrait while scanning ───────────
    // The aim frame is rectangular (wider than tall) and assumes the
    // page is in portrait. If the user rotates the phone — say to get
    // a better angle on an open can they can't tilt — the screen
    // flips to landscape and the aim frame moves with it. Locking
    // orientation pins the overlay so the user can physically rotate
    // the device freely without the UI rotating underneath them.
    //
    // Browser support is uneven:
    //   - Android Chrome: works, but only inside fullscreen mode
    //   - iOS Safari    : doesn't support screen.orientation.lock at all,
    //                     even in fullscreen. Best we can do is the
    //                     visible hint and hope for the best.
    //   - Desktop       : no-op, since rotation isn't a concern there.
    //
    // We try fullscreen + lock; if either step fails (no user gesture,
    // unsupported, etc.) we silently fall through to "scanner works
    // but doesn't lock orientation."
    let didEnterFullscreen = false
    let didLockOrientation = false
    async function lockOrientation() {
      try {
        // requestFullscreen needs a user gesture; the click that opened
        // the scanner counts on most browsers.
        if (document.documentElement?.requestFullscreen && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen()
          didEnterFullscreen = true
        }
        if (screen.orientation?.lock) {
          await screen.orientation.lock('portrait')
          didLockOrientation = true
        }
      } catch { /* graceful no-op — iOS Safari, denied gestures, etc. */ }
    }
    lockOrientation()

    // Request the rear-facing camera explicitly. On phones this is what
    // the user actually wants — they hold the device with the screen
    // facing them and aim the back at the barcode. `ideal` instead of
    // `exact` so desktop browsers (no rear camera) still get the only
    // available camera rather than failing outright.
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width:      { ideal: 1280 },
        height:     { ideal: 720 },
      },
    }

    reader.decodeFromConstraints(
      constraints,
      videoRef.current,
      (result, _err, controls) => {
        controlsRef.current = controls
        if (!ready) setReady(true)
        if (stopped || !result) return
        stopped = true
        controls.stop()
        onScan(result.getText())
      }
    ).catch(err => {
      const msg = err?.message ?? String(err)
      setError(
        msg.toLowerCase().includes('permission')
          ? 'Camera permission denied. Please allow camera access and try again.'
          : msg.toLowerCase().includes('device') || msg.toLowerCase().includes('found')
          ? 'No camera found on this device.'
          : `Camera error: ${msg}`
      )
    })

    return () => {
      stopped = true
      try { controlsRef.current?.stop() } catch { /* already stopped */ }
      // Tear down orientation lock + fullscreen in reverse order so
      // the page returns to whatever rotation policy it had before.
      if (didLockOrientation) { try { screen.orientation.unlock?.() } catch {} }
      if (didEnterFullscreen && document.exitFullscreen && document.fullscreenElement) {
        try { document.exitFullscreen() } catch {}
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 px-4">
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
        aria-label="Close scanner"
      >
        <X className="h-5 w-5" />
      </button>

      {error ? (
        <div className="w-full max-w-sm rounded-xl bg-card border border-border p-6 text-center space-y-3">
          <Camera className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />

            {/* Aim overlay */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="relative w-56 h-28">
                <span className="absolute top-0 left-0  h-5 w-5 border-t-2 border-l-2 border-primary rounded-tl" />
                <span className="absolute top-0 right-0 h-5 w-5 border-t-2 border-r-2 border-primary rounded-tr" />
                <span className="absolute bottom-0 left-0  h-5 w-5 border-b-2 border-l-2 border-primary rounded-bl" />
                <span className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-primary rounded-br" />
                {/* Scanline — animated `top` from 0% to ~100% via the
                    `scanline` keyframes defined in tailwind.config.js.
                    No static `top` class because the animation drives it. */}
                <span className="absolute left-0 right-0 h-px bg-primary/70 animate-scanline" />
              </div>
            </div>

            {/* Spinner while camera initialises */}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            )}
          </div>
          <p className="text-center text-white/50 text-xs leading-relaxed">
            Align the barcode horizontally inside the frame.
            <br />
            Rotate your phone or the product so the barcode runs left-to-right.
          </p>
        </div>
      )}
    </div>
  )
}
