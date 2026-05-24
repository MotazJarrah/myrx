/**
 * AvatarCropper — draggable circular crop area + zoom slider, mirrors
 * mobile's `src/components/ImageCropper.tsx`. Used by the Account page
 * (EditProfile.jsx ProfileTab) after the user picks a photo.
 *
 * Same cropping engine that powers Signup.jsx's photo step
 * (`react-easy-crop` + `cropAndDownscale`). Extracted into a component
 * so the Account page doesn't have to duplicate ~80 lines of cropper
 * state + canvas wiring.
 *
 * Props:
 *   file       — raw picked File (from <input type="file">)
 *   onApply    — (blob: Blob) — fired with the cropped JPEG (512×512 @ 0.85)
 *   onCancel   — fired when the user backs out without committing
 *
 * Sizing matches Signup's PhotoScreen (272 px square crop window, 1×–3×
 * zoom range, circular mask, no grid overlay). The output is always a
 * 512×512 JPEG Blob the parent can upload directly to storage.
 */
import { useState, useEffect, useRef } from 'react'
import Cropper from 'react-easy-crop'
import { Check, X as XIcon, Loader2, AlertCircle } from 'lucide-react'
import { cropAndDownscale } from '../lib/imageUtils'

const TARGET_DIM     = 512
const TARGET_QUALITY = 0.85

export default function AvatarCropper({ file, onApply, onCancel }) {
  const [crop, setCrop]                 = useState({ x: 0, y: 0 })
  const [zoom, setZoom]                 = useState(1)
  const [croppedAreaPixels, setCAP]     = useState(null)
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState('')
  const [imgUrl, setImgUrl]             = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Create an ObjectURL for the cropper to read. Revoke on unmount /
  // file change so we don't leak.
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCAP(null)
    setError('')
    return () => URL.revokeObjectURL(url)
  }, [file])

  const onCropComplete = (_, areaPixels) => setCAP(areaPixels)

  async function handleApply() {
    if (!file) return
    if (!croppedAreaPixels) {
      setError('Adjust the crop area, then Apply.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const blob = await cropAndDownscale(file, croppedAreaPixels, {
        size:    TARGET_DIM,
        quality: TARGET_QUALITY,
      })
      if (!mountedRef.current) return
      onApply(blob)
    } catch (e) {
      if (mountedRef.current) {
        setError(e?.message || 'Could not crop the photo.')
        setSubmitting(false)
      }
    }
  }

  if (!imgUrl) return null

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-64 w-full overflow-hidden rounded-xl border border-border bg-card/40">
        <Cropper
          image={imgUrl}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          objectFit="contain"
          restrictPosition
          style={{ containerStyle: { background: 'transparent' } }}
        />
      </div>

      {/* Zoom slider — same widget as Signup */}
      <div className="w-full px-1 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">−</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="flex-1 h-1.5 bg-border rounded-full appearance-none accent-primary cursor-pointer"
        />
        <span className="text-xs text-muted-foreground">+</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive w-full">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Apply / Cancel — mirrors mobile's ImageCropper button row */}
      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={submitting}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {submitting
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</>
            : <><Check className="h-3.5 w-3.5" /> Apply</>}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-accent px-3.5 py-2 text-[13px] text-foreground transition-colors disabled:opacity-50"
        >
          <XIcon className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
    </div>
  )
}
