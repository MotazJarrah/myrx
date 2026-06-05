/**
 * CueText — the ONE coaching-cue renderer (T088 round-2 locked format), web mirror
 * of mobile/src/components/CueText.tsx.
 *
 * Pass a plain cue sentence as a string child; it renders muted prose with every
 * number+unit token auto-emphasized — weights (lb/kg) blue, all other numbers
 * foreground, bold mono. Every coaching cue in the admin coach view routes through
 * this so the format is identical by construction.
 *
 * LOCKED cue rules (enforce in the strings you pass):
 *   • one flowing sentence (or two), prose — never bullets
 *   • commas / semicolons, NEVER em-dashes
 *   • NEVER put attribution inside a cue (credit lives on its own line)
 */
const CUE_TOKEN_RE = /\d[\d.,/–-]*(?:\s?[×x]\s?\d[\d.,/–-]*)?(?:\s?(?:lb|kg|km|mi|min|sec|reps?|sets?|m|s|%))?/g

export default function CueText({ children, className = 'text-sm text-muted-foreground' }) {
  const text = String(children ?? '')
  const out = []
  let last = 0, key = 0, cursor = 0
  for (const tok of text.match(CUE_TOKEN_RE) || []) {
    const at = text.indexOf(tok, cursor)
    if (at < 0) continue
    if (at > last) out.push(text.slice(last, at))
    out.push(
      <span
        key={key++}
        className={`font-mono font-semibold ${/\b(?:lb|kg)\b/.test(tok) ? 'text-blue-400' : 'text-foreground'}`}
      >
        {tok}
      </span>
    )
    last = at + tok.length
    cursor = last
  }
  if (last < text.length) out.push(text.slice(last))
  return <p className={className}>{out}</p>
}
