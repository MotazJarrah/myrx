import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { colors, palette, fonts } from '../theme'

/**
 * CueText — the ONE coaching-cue renderer (T088 round-2 locked format).
 *
 * Pass a plain cue sentence as a string child; it renders muted prose with every
 * number+unit token auto-emphasized — weights (lb/kg) blue, all other numbers
 * foreground, bold mono. Every coaching cue across strength AND cardio routes
 * through this so the format is identical by construction.
 *
 * LOCKED cue rules (enforce in the strings you pass):
 *   • one flowing sentence (or two), prose — never bullets
 *   • commas / semicolons, NEVER em-dashes
 *   • NEVER put attribution inside a cue (credit lives on its own line)
 *
 * `style` overrides the base prose style (e.g. a smaller tinyText size); the
 * number spans inherit fontSize from it, so they always match the surrounding text.
 */
const CUE_TOKEN_RE = /\d[\d.,/–-]*(?:\s?[×x]\s?\d[\d.,/–-]*)?(?:\s?(?:lb|kg|km|mi|min|sec|reps?|sets?|m|s|%))?/g

export default function CueText({ children, style }: { children?: string; style?: any }) {
  const text = children ?? ''
  const out: React.ReactNode[] = []
  let last = 0, key = 0, cursor = 0
  for (const tok of text.match(CUE_TOKEN_RE) ?? []) {
    const at = text.indexOf(tok, cursor)
    if (at < 0) continue
    if (at > last) out.push(text.slice(last, at))
    out.push(
      <Text key={key++} style={/\b(?:lb|kg)\b/.test(tok) ? st.numBlue : st.num}>{tok}</Text>
    )
    last = at + tok.length
    cursor = last
  }
  if (last < text.length) out.push(text.slice(last))
  return <Text style={[st.base, style]}>{out}</Text>
}

const st = StyleSheet.create({
  base:    { color: colors.mutedForeground, fontSize: 14 },
  num:     { color: colors.foreground, fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
  numBlue: { color: palette.blue[400], fontFamily: fonts.mono[600], fontVariant: ['tabular-nums'] },
})
