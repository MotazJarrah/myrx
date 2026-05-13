/**
 * BarcodeScanner — port of MyRX/src/components/BarcodeScanner.jsx to React Native.
 *
 * Web uses @zxing/browser; mobile uses `expo-camera`'s built-in `CameraView`
 * with `barcodeScannerSettings`. Permission is requested on first use and the
 * scanner overlay handles the granted/denied/error states.
 *
 * Calls `onScan(rawText)` exactly once on the first successful read, then closes
 * itself implicitly by ignoring further scans (parent removes the component).
 *
 * The aim-box is a simple centred frame: corner brackets + a horizontal
 * scan line that sweeps up and down inside the box (matches the web's CSS
 * keyframe animation on the same line).
 */

import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { X, Camera } from 'lucide-react-native'
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from 'react-native-reanimated'
import { colors, alpha } from '../theme'

interface Props {
  onScan:  (text: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onScan, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const [error, setError] = useState<string | null>(null)
  // Guard so onScan only fires once per scanner mount (mirrors web's `stopped` flag)
  const handledRef = useRef(false)

  // ── Scan-line sweep animation ───────────────────────────────────────────
  // Mirrors web's CSS-keyframe sweep: the line travels up and down within
  // the aim-box (224 × 112 px), ±48 px from centre. `withRepeat` with
  // reverse=true ping-pongs it indefinitely; ease-in-out gives the natural
  // "slow at the edges, faster in the middle" sweep.
  const lineY = useSharedValue(-48)
  useEffect(() => {
    lineY.value = withRepeat(
      withTiming(48, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
  }, [lineY])
  const lineAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lineY.value }],
  }))

  // Auto-request on first mount if undetermined
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(e => {
        setError(`Camera permission error: ${String(e)}`)
      })
    }
  }, [permission, requestPermission])

  // Permission denied with no further prompt — show explainer
  useEffect(() => {
    if (permission && !permission.granted && !permission.canAskAgain) {
      setError('Camera permission denied. Please allow camera access in system settings and try again.')
    }
  }, [permission])

  function handleScan(result: BarcodeScanningResult) {
    if (handledRef.current) return
    handledRef.current = true
    onScan(result.data)
  }

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <View style={s.container}>
        {/* Close */}
        <Pressable
          onPress={onClose}
          style={s.closeBtn}
          accessibilityLabel="Close scanner"
          hitSlop={12}
        >
          <X size={20} color="#fff" />
        </Pressable>

        {error || (permission && !permission.granted && !permission.canAskAgain) ? (
          <View style={s.errorCard}>
            <Camera size={32} color={colors.mutedForeground} style={{ alignSelf: 'center' }} />
            <Text style={s.errorText}>{error ?? 'Camera permission required.'}</Text>
            <Pressable onPress={onClose} style={s.errorBtn}>
              <Text style={s.errorBtnText}>Close</Text>
            </Pressable>
          </View>
        ) : permission?.granted ? (
          <View style={s.viewport}>
            <View style={s.cameraFrame}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{
                  // EAN-13/UPC-A/UPC-E covers food barcodes
                  barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
                }}
                onBarcodeScanned={handleScan}
              />

              {/* Aim overlay — corner brackets + animated scan line */}
              <View pointerEvents="none" style={s.aimOverlay}>
                <View style={s.aimBox}>
                  <View style={[s.corner, s.cornerTL]} />
                  <View style={[s.corner, s.cornerTR]} />
                  <View style={[s.corner, s.cornerBL]} />
                  <View style={[s.corner, s.cornerBR]} />
                  <Animated.View style={[s.scanLine, lineAnimStyle]} />
                </View>
              </View>
            </View>

            <Text style={s.hint}>Align the barcode inside the frame</Text>
          </View>
        ) : (
          /* Permission still being determined — spinner */
          <View style={s.viewport}>
            <View style={[s.cameraFrame, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#fff', fontSize: 13 }}>Requesting camera access…</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 40,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  viewport: {
    width: '100%',
    maxWidth: 384,
    gap: 12,
  },
  cameraFrame: {
    aspectRatio: 4 / 3,
    width: '100%',
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  aimOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aimBox: {
    width: 224,
    height: 112,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: colors.primary,
  },
  cornerTL: { top: 0, left: 0,  borderTopWidth: 2,    borderLeftWidth: 2,  borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 2,    borderRightWidth: 2, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0,  borderBottomWidth: 2, borderLeftWidth: 2,  borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 4 },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: alpha(colors.primary, 0.7),
  },
  hint: {
    color: 'rgba(255,255,255,0.50)',
    textAlign: 'center',
    fontSize: 12,
  },
  errorCard: {
    width: '100%',
    maxWidth: 384,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    gap: 12,
  },
  errorText: { color: colors.destructive, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorBtn: {
    alignSelf: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorBtnText: { color: colors.mutedForeground, fontSize: 14 },
})
