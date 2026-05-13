/**
 * BarcodeScanner
 * Full-screen camera overlay using @zxing/browser.
 * Calls onScan(rawText) on first read, onClose() on dismiss.
 */

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { X, Camera } from 'lucide-react'

export function BarcodeScanner({ onScan, onClose }) {
  const videoRef    = useRef(null)
  const controlsRef = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let stopped  = false

    reader.decodeFromVideoDevice(
      undefined,
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
          : msg.toLowerCase().includes('device')
          ? 'No camera found on this device.'
          : `Camera error: ${msg}`
      )
    })

    return () => {
      stopped = true
      try { controlsRef.current?.stop() } catch { /* already stopped */ }
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
                <span className="absolute left-0 right-0 top-1/2 h-px bg-primary/70 animate-scanline" />
              </div>
            </div>

            {/* Spinner while camera initialises */}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            )}
          </div>
          <p className="text-center text-white/50 text-xs">Align the barcode inside the frame</p>
        </div>
      )}
    </div>
  )
}
