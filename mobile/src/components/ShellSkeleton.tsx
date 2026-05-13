/**
 * ShellSkeleton — neutral page-shell skeleton shown during cold-start
 * before auth/profile state has resolved. Mirrors the web `ShellSkeleton.jsx`.
 *
 * Replaces the earlier `LoadingScreen` (animated logo with neon glow) at
 * routes-level boundaries. Modern apps (Facebook, Instagram, LinkedIn)
 * keep their cold-start splash to a brief native static logo (Expo splash)
 * + then jump straight to skeleton screens. This component is what they
 * jump to once React mounts.
 */

import { View } from 'react-native'
import { colors } from '../theme'
import Skeleton from './Skeleton'

export default function ShellSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Top bar */}
      <View style={{
        height: 56,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
      }}>
        <Skeleton style={{ height: 32, width: 88, borderRadius: 6 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Skeleton style={{ height: 36, width: 36, borderRadius: 9999 }} />
          <Skeleton style={{ height: 36, width: 36, borderRadius: 9999 }} />
        </View>
      </View>

      {/* Body */}
      <View style={{ padding: 16, gap: 16 }}>
        <Skeleton style={{ height: 128, width: '100%', borderRadius: 16 }} />
        <Skeleton style={{ height: 192, width: '100%', borderRadius: 16 }} />
        <Skeleton style={{ height: 128, width: '100%', borderRadius: 16 }} />
      </View>
    </View>
  )
}
