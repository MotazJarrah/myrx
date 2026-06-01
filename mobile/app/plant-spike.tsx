/**
 * Plant spike — per-leaf proof via DATA BINDING (June 1 2026).
 *
 * The remixed wavy_plant.riv now carries a "PlantControl" view model with 5
 * boolean properties (leaf1..leaf5), each bound in the Rive editor to one leaf's
 * "active" input. We bind the VM at runtime with AutoBind(true) and flip each
 * property with the useRiveBoolean(path) setters — leaf1=true opens leaf 1, etc.
 *
 * This proves leaves can open ONE AT A TIME from app code (the "2 clicks per
 * leaf" + hydration mapping then lives entirely in JS). Reachable at
 * myrx://plant-spike. DELETE once the hydration page is wired.
 */

import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import Rive, { Fit, Alignment, useRive, useRiveBoolean, AutoBind } from 'rive-react-native'
import { colors, palette, fonts, withAlpha } from '../src/theme'

const SM = 'State Machine 1'
const TOTAL_LEAVES = 5

export default function PlantSpikeScreen() {
  const [setRiveRef, riveRef] = useRive()
  const [openCount, setOpenCount] = useState(0)
  const [log, setLog] = useState<string[]>(['plant loaded — data-binding mode'])
  const pushLog = (line: string) => setLog((p) => [line, ...p].slice(0, 10))

  // One boolean setter per leaf, via the PlantControl view-model properties.
  const [, setLeaf1] = useRiveBoolean(riveRef, 'leaf1')
  const [, setLeaf2] = useRiveBoolean(riveRef, 'leaf2')
  const [, setLeaf3] = useRiveBoolean(riveRef, 'leaf3')
  const [, setLeaf4] = useRiveBoolean(riveRef, 'leaf4')
  const [, setLeaf5] = useRiveBoolean(riveRef, 'leaf5')
  const setters = [setLeaf1, setLeaf2, setLeaf3, setLeaf4, setLeaf5]

  const openNext = () => {
    if (openCount >= TOTAL_LEAVES) { pushLog('all leaves already open'); return }
    const n = openCount + 1
    try { setters[n - 1]?.(true); pushLog(`leaf${n} = true`) } catch (e) { pushLog(`leaf${n} err: ${String(e)}`) }
    setOpenCount(n)
  }
  const reset = () => {
    setters.forEach((s, i) => { try { s?.(false) } catch (e) { pushLog(`reset leaf${i + 1} err`) } })
    setOpenCount(0)
    pushLog('reset — all leaves closed')
  }
  const allOn = () => {
    setters.forEach((s) => { try { s?.(true) } catch {} })
    setOpenCount(TOTAL_LEAVES)
    pushLog('all leaves on (leaf1..5 = true)')
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={colors.foreground} />
        </Pressable>
        <Text style={s.title}>Plant Spike — data-bind</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.stage}>
          <Rive
            ref={setRiveRef}
            resourceName="wavy_plant"
            artboardName="plant"
            stateMachineName={SM}
            dataBinding={AutoBind(true)}
            autoplay
            fit={Fit.Contain}
            alignment={Alignment.Center}
            style={s.rive}
            onError={(e: any) => pushLog(`✗ ${e?.message ?? JSON.stringify(e)}`)}
          />
        </View>

        <Text style={s.caption}>Leaves open: {openCount} / {TOTAL_LEAVES}</Text>

        <View style={s.row}>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={openNext}>
            <Text style={s.btnText}>Open next leaf 🌱</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnGhost]} onPress={reset}>
            <Text style={[s.btnText, s.btnTextGhost]}>Reset</Text>
          </Pressable>
        </View>
        <Pressable style={[s.btn, s.btnGhost, { alignSelf: 'center' }]} onPress={allOn}>
          <Text style={[s.btnText, s.btnTextGhost]}>All leaves on</Text>
        </Pressable>

        <View style={s.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={[s.logLine, i === 0 && s.logHead]}>{line}</Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  title: { color: colors.foreground, fontSize: 18, fontFamily: fonts.sans[700] },
  scroll: { padding: 16, gap: 16 },
  stage: { height: 360, borderRadius: 16, borderWidth: 1, borderColor: withAlpha(palette.myrx.lime, 0.25), backgroundColor: '#0a0f12', overflow: 'hidden' },
  rive: { flex: 1 },
  caption: { color: colors.mutedForeground, fontSize: 13, textAlign: 'center', fontFamily: fonts.sans[600] },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  btn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  btnPrimary: { backgroundColor: palette.myrx.lime },
  btnGhost: { backgroundColor: withAlpha(palette.myrx.lime, 0.12), borderWidth: 1, borderColor: withAlpha(palette.myrx.lime, 0.3) },
  btnText: { fontSize: 14, fontFamily: fonts.sans[700], color: '#0b1f12' },
  btnTextGhost: { color: colors.foreground },
  logBox: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: withAlpha('#000000', 0.25), padding: 12, gap: 4 },
  logLine: { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.mono[400] },
  logHead: { color: palette.myrx.lime },
})
