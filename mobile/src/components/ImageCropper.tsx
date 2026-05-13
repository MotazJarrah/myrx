/**
 * ImageCropper — inline draggable circular crop area, mirrors web's
 * react-easy-crop UX (MyRX/src/pages/EditProfile.jsx + Signup.jsx
 * PhotoScreen). Replaces expo-image-picker's `allowsEditing` system UI
 * which on Android renders a tiny barely-visible thumbnail with the
 * crop indicator floating on top.
 *
 * Design parity with web:
 *   • Fixed-height crop area (288 = 18rem = h-72 in tailwind).
 *   • Image fills the area with pan + pinch gestures (gesture-handler
 *     + reanimated). Web uses mouse drag + pinch / scroll-wheel zoom;
 *     mobile uses native gestures. Same outcome: user repositions
 *     the image inside the crop circle.
 *   • Circular crop indicator drawn via SVG mask so the dark overlay
 *     has a clean circular cutout (RN can't do CSS clip-path).
 *   • Below the crop area: zoom slider (1× → 3×) + Apply/Cancel.
 *   • On Apply: ImageManipulator.crop + resize to 512×512 JPEG @ 0.85
 *     quality, then hands the URI back to the caller.
 *
 * Output is a JPEG file URI that the caller passes to uploadAvatar()
 * (same contract as expo-image-picker's result).
 */

import { useState, useEffect } from 'react'
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Image, LayoutChangeEvent,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue, useAnimatedStyle, runOnJS,
} from 'react-native-reanimated'
import Svg, { Defs, Mask, Rect, Circle } from 'react-native-svg'
import { Loader as Loader2, AlertCircle, Minus, Plus } from 'lucide-react-native'
import * as ImageManipulator from 'expo-image-manipulator'
import { colors, palette, alpha } from '../theme'

// Match web: h-72 = 18rem = 288px. Wide enough for a 256-diameter
// circle with comfortable margin.
const CROP_AREA_HEIGHT = 288
const CROP_DIAMETER = 240    // visible circle (matches web's contained crop)
const TARGET_DIM = 512        // output square dimensions
const TARGET_QUALITY = 0.85
const MIN_ZOOM = 1
const MAX_ZOOM = 3

interface Props {
  uri: string
  onApply: (result: { uri: string; mime: 'image/jpeg' }) => void
  onCancel: () => void
  // Optional: button label for the apply action ('Apply' on EditProfile,
  // 'Looks good' or similar on the signup PhotoScreen).
  applyLabel?: string
}

export function ImageCropper({ uri, onApply, onCancel, applyLabel = 'Apply' }: Props) {
  // `normalizedUri` is the source URI run through ImageManipulator
  // with an explicit `rotate: 0` so the bitmap pipeline decodes the
  // source (applying EXIF rotation), renders pixels, and re-encodes
  // to JPEG with the rotation BAKED IN and no EXIF metadata on the
  // output.
  //
  // Why not `manipulateAsync(uri, [], { format: JPEG })`? On some
  // platforms an empty actions array short-circuits to a file copy
  // without re-rendering, and EXIF orientation is preserved on the
  // output. The visible Image renderer applies EXIF visually, but
  // ImageManipulator.crop operates on PRE-rotation pixel coords —
  // so the crop region the user sees and the crop region we extract
  // disagree. The explicit `rotate: 0` forces the full decode-
  // render-encode path, which always applies EXIF. The 0° rotation
  // is a visual no-op.
  //
  // We also read width/height from the manipulator's RETURN value
  // (not a separate Image.getSize call) so the dimensions we use
  // for the crop math are guaranteed to match the dimensions of
  // the file we're cropping.
  const [normalizedUri, setNormalizedUri] = useState<string | null>(null)
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null)
  const [containerW, setContainerW] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Reanimated transform shared values. tx/ty are pan offsets in screen
  // pixels; userZoom is the slider/pinch multiplier on top of baseScale.
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const userZoom = useSharedValue(1)
  const startTx = useSharedValue(0)
  const startTy = useSharedValue(0)
  const startZoom = useSharedValue(1)
  // Mirror imageDims into shared values so the gesture handlers (UI
  // thread) can read them without touching React state.
  const imgWSV = useSharedValue(0)
  const imgHSV = useSharedValue(0)
  const baseScaleSV = useSharedValue(1)

  // Slider state lives in JS so we can render the +/− chevrons reactively.
  // Sync into userZoom (worklet shared value) on user change.
  const [zoomState, setZoomState] = useState(1)

  useEffect(() => {
    let cancelled = false
    setError('')
    setImageDims(null)
    setNormalizedUri(null)
    ;(async () => {
      try {
        // `rotate: 0` forces a full decode-render-encode cycle so EXIF
        // orientation gets baked into pixels. See the comment on
        // `normalizedUri` above for why empty actions aren't enough.
        const out = await ImageManipulator.manipulateAsync(
          uri,
          [{ rotate: 0 }],
          { format: ImageManipulator.SaveFormat.JPEG, compress: 1.0 },
        )
        if (cancelled) return
        setNormalizedUri(out.uri)
        // out.width / out.height come from the manipulator and are
        // already EXIF-applied. Using them directly avoids any
        // disagreement with what Image.getSize might report.
        setImageDims({ w: out.width, h: out.height })
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load that image.')
      }
    })()
    return () => { cancelled = true }
  }, [uri])

  // baseScale: minimum scale at which the image fully covers the crop
  // circle. Whatever the user picks (zoom slider / pinch), the
  // effective scale is `baseScale * userZoom` and is always ≥ baseScale.
  const baseScale = imageDims
    ? Math.max(CROP_DIAMETER / imageDims.w, CROP_DIAMETER / imageDims.h)
    : 1

  useEffect(() => {
    // Re-sync shared values whenever the image or its measured size
    // changes; reset transforms so each new pick starts centered at 1×.
    if (!imageDims) return
    imgWSV.value = imageDims.w
    imgHSV.value = imageDims.h
    baseScaleSV.value = baseScale
    tx.value = 0
    ty.value = 0
    userZoom.value = 1
    setZoomState(1)
  }, [imageDims, baseScale, imgWSV, imgHSV, baseScaleSV, tx, ty, userZoom])

  function clampToBounds(nextTx: number, nextTy: number, scale: number) {
    'worklet'
    if (!imgWSV.value || !imgHSV.value) return { tx: 0, ty: 0 }
    const effective = baseScaleSV.value * scale
    const maxTx = (imgWSV.value * effective - CROP_DIAMETER) / 2
    const maxTy = (imgHSV.value * effective - CROP_DIAMETER) / 2
    return {
      tx: Math.max(-maxTx, Math.min(maxTx, nextTx)),
      ty: Math.max(-maxTy, Math.min(maxTy, nextTy)),
    }
  }

  const panGesture = Gesture.Pan()
    .onStart(() => {
      'worklet'
      startTx.value = tx.value
      startTy.value = ty.value
    })
    .onUpdate((e) => {
      'worklet'
      const next = clampToBounds(
        startTx.value + e.translationX,
        startTy.value + e.translationY,
        userZoom.value,
      )
      tx.value = next.tx
      ty.value = next.ty
    })

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      'worklet'
      startZoom.value = userZoom.value
    })
    .onUpdate((e) => {
      'worklet'
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZoom.value * e.scale))
      userZoom.value = newZoom
      // Re-clamp pan now that scale changed.
      const next = clampToBounds(tx.value, ty.value, newZoom)
      tx.value = next.tx
      ty.value = next.ty
      runOnJS(setZoomState)(newZoom)
    })

  const composed = Gesture.Simultaneous(panGesture, pinchGesture)

  const imageAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: baseScaleSV.value * userZoom.value },
    ],
  }))

  function setZoom(z: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
    userZoom.value = clamped
    setZoomState(clamped)
    // Re-clamp pan after a slider change so the image stays centered.
    const next = clampToBounds(tx.value, ty.value, clamped)
    tx.value = next.tx
    ty.value = next.ty
  }

  async function handleApply() {
    if (!imageDims || !normalizedUri) return
    setBusy(true); setError('')
    try {
      const effective = baseScale * userZoom.value
      // Crop window in image-space coordinates. The crop window is
      // CROP_DIAMETER × CROP_DIAMETER in screen-space, centered on
      // the container; image is centered + transformed by (tx, ty,
      // scale). Inverse: cropX/Y in image-space.
      const cropW = CROP_DIAMETER / effective
      const cropH = CROP_DIAMETER / effective
      const cropX = imageDims.w / 2 - cropW / 2 - tx.value / effective
      const cropY = imageDims.h / 2 - cropH / 2 - ty.value / effective

      // ImageManipulator's crop is permissive about non-integer values
      // but expects them inside the source bounds. Clamp defensively.
      const safeX = Math.max(0, Math.min(imageDims.w - 1, cropX))
      const safeY = Math.max(0, Math.min(imageDims.h - 1, cropY))
      const safeW = Math.max(1, Math.min(imageDims.w - safeX, cropW))
      const safeH = Math.max(1, Math.min(imageDims.h - safeY, cropH))

      // Crop the NORMALIZED uri — same coord system the user just
      // panned/zoomed in. Cropping the original `uri` would re-apply
      // EXIF-rotation skew to the result.
      const out = await ImageManipulator.manipulateAsync(
        normalizedUri,
        [
          { crop: { originX: safeX, originY: safeY, width: safeW, height: safeH } },
          { resize: { width: TARGET_DIM, height: TARGET_DIM } },
        ],
        { compress: TARGET_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      )
      onApply({ uri: out.uri, mime: 'image/jpeg' })
    } catch (e: any) {
      setError(e?.message || 'Could not process that image.')
    } finally {
      setBusy(false)
    }
  }

  function onLayout(e: LayoutChangeEvent) {
    setContainerW(e.nativeEvent.layout.width)
  }

  return (
    <View>
      <View onLayout={onLayout} style={s.cropArea}>
        {imageDims && normalizedUri ? (
          <>
            <GestureDetector gesture={composed}>
              <Animated.View
                style={[StyleSheet.absoluteFill, s.gestureLayer]}
                collapsable={false}
              >
                <Animated.Image
                  source={{ uri: normalizedUri }}
                  style={[
                    {
                      width: imageDims.w,
                      height: imageDims.h,
                    },
                    imageAnimStyle,
                  ]}
                />
              </Animated.View>
            </GestureDetector>

            {/* Circular crop overlay: dark mask everywhere with a
                transparent circle in the middle, plus a crisp 1px
                ring marking the crop boundary. */}
            {containerW > 0 && (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Svg width={containerW} height={CROP_AREA_HEIGHT}>
                  <Defs>
                    <Mask id="cropHole">
                      <Rect width="100%" height="100%" fill="white" />
                      <Circle
                        cx={containerW / 2}
                        cy={CROP_AREA_HEIGHT / 2}
                        r={CROP_DIAMETER / 2}
                        fill="black"
                      />
                    </Mask>
                  </Defs>
                  <Rect
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.55)"
                    mask="url(#cropHole)"
                  />
                  <Circle
                    cx={containerW / 2}
                    cy={CROP_AREA_HEIGHT / 2}
                    r={CROP_DIAMETER / 2}
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth={1}
                    fill="none"
                  />
                </Svg>
              </View>
            )}
          </>
        ) : (
          <View style={s.loadingShell}>
            {error ? (
              <Text style={s.errorText}>{error}</Text>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
        )}
      </View>

      {/* Zoom slider — matches web's `−` ── slider ── `+` row.
          The slider is built from a Pressable track + a draggable
          thumb so we don't pull in @react-native-community/slider
          (one less native dep). */}
      <ZoomSlider value={zoomState} min={MIN_ZOOM} max={MAX_ZOOM} onChange={setZoom} />

      {error && imageDims ? (
        <View style={s.errorRow}>
          <AlertCircle size={14} color={colors.destructive} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={s.btnRow}>
        <Pressable
          onPress={handleApply}
          disabled={busy || !imageDims}
          style={[s.btnPrimary, (busy || !imageDims) ? s.btnDisabled : null]}
        >
          {busy ? (
            <View style={s.btnInner}>
              <Loader2 size={14} color={colors.primaryForeground} />
              <Text style={s.btnPrimaryText}>Applying…</Text>
            </View>
          ) : (
            <Text style={s.btnPrimaryText}>{applyLabel}</Text>
          )}
        </Pressable>
        <Pressable onPress={onCancel} disabled={busy} style={s.btnSecondary}>
          <Text style={s.btnSecondaryText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

// Self-contained zoom slider built from a track + draggable thumb.
// Avoids pulling in @react-native-community/slider for a single use.
function ZoomSlider({
  value, min, max, onChange,
}: {
  value: number; min: number; max: number; onChange: (n: number) => void
}) {
  const [trackW, setTrackW] = useState(0)
  const ratio = trackW > 0 ? (value - min) / (max - min) : 0
  const thumbX = ratio * trackW

  const startRatio = useSharedValue(0)
  const dragGesture = Gesture.Pan()
    .onStart(() => {
      'worklet'
      startRatio.value = ratio
    })
    .onUpdate((e) => {
      'worklet'
      if (trackW <= 0) return
      const next = Math.max(0, Math.min(1, startRatio.value + e.translationX / trackW))
      runOnJS(onChange)(min + next * (max - min))
    })

  return (
    <View style={s.sliderRow}>
      <Minus size={14} color={colors.mutedForeground} />
      <View
        style={s.sliderTrackOuter}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        <View style={s.sliderTrack} />
        <View style={[s.sliderFill, { width: thumbX }]} />
        <GestureDetector gesture={dragGesture}>
          <View
            style={[s.sliderThumb, { left: Math.max(0, thumbX - 10) }]}
            hitSlop={12}
          />
        </GestureDetector>
      </View>
      <Plus size={14} color={colors.mutedForeground} />
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────
const s = StyleSheet.create({
  cropArea: {
    height: CROP_AREA_HEIGHT,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gestureLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingShell: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8,
  },
  errorText: {
    color: colors.destructive, fontSize: 12,
  },

  // Slider row — `−` track `+`
  sliderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 16, paddingHorizontal: 4,
  },
  sliderTrackOuter: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  sliderFill: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    top: '50%',
    marginTop: -2,
  },
  sliderThumb: {
    position: 'absolute',
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.primary,
    top: '50%', marginTop: -10,
    borderWidth: 2,
    borderColor: alpha(palette.emerald[500], 1),
  },

  // Apply / Cancel
  btnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 16,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnPrimaryText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  btnSecondaryText: { color: colors.foreground, fontSize: 14 },
  btnDisabled: { opacity: 0.6 },
})
