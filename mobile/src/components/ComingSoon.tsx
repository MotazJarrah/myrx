/**
 * Temporary placeholder for routes that haven't been ported yet.
 * Each web page gets ported in its own pass — this stub keeps the nav working.
 */

import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../theme'

export default function ComingSoon({ title }: { title: string }) {
  return (
    <View style={s.container}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.sub}>This page hasn't been ported yet.</Text>
      <Text style={s.note}>
        Per the rebuild plan: pages are ported one at a time, with full functionality.
        This route exists so the navigation works while the dashboard is being verified.
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: { paddingVertical: 48, paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  sub:   { color: colors.mutedForeground, fontSize: 14 },
  note:  { color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 16, opacity: 0.7, lineHeight: 18 },
})
