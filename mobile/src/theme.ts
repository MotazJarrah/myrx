/**
 * Design tokens — 1:1 mirror of MyRX web app's src/index.css :root.dark variables.
 *
 * Keep token NAMES identical to the web's CSS vars so any cross-reference is direct.
 * RN supports hsl()/hsla() in style strings, so we keep colors in HSL exactly like
 * the web stores them — that way `bg-primary/10` translates to `alpha(c.primary, 0.1)`
 * with zero numeric drift.
 */

// ── Raw HSL strings (dark mode — matches web's .dark CSS class) ──────────────
//
// MyRX Brand Palette (LOCKED — May 29 2026, see branding/BRAND.md):
//   MyRX Lime       #CAF240  hsl(73°, 87%, 60%)    — primary accent
//   MyRX Dark       #121721  hsl(220°, 28%, 10%)   — background
//   MyRX Surface    #171C26  hsl(220°, 24%, 12%)   — elevated surface
//   MyRX Foreground #F4F3EF  hsl(60°, 5%, 96%)     — text on dark
//
// Neutrals on H=220 (blue) sit near-complementary to the lime (H=73,
// yellow-green), ~147° apart on the color wheel — that hue separation
// makes the lime POP against the dark surface. Saturation (28% BG /
// 24% card) is the lever that makes the dark read as blue, not grey.
// Pure black and pure white are banned on dark surfaces — always use
// these tokens.
const HSL = {
  background:        'hsl(220, 28%, 10%)',
  foreground:        'hsl(60, 5%, 96%)',
  border:            'hsl(220, 8%, 16%)',
  card:              'hsl(220, 24%, 12%)',
  cardForeground:    'hsl(60, 5%, 96%)',
  sidebar:           'hsl(220, 26%, 11%)',
  sidebarForeground: 'hsl(60, 5%, 96%)',
  sidebarBorder:     'hsl(220, 8%, 14%)',
  sidebarPrimary:    'hsl(73, 87%, 60%)',
  primary:           'hsl(73, 87%, 60%)',     // MyRX Lime #CAF240 (LOCKED)
  primaryForeground: 'hsl(220, 28%, 10%)',
  secondary:         'hsl(220, 10%, 14%)',
  secondaryForeground:'hsl(60, 5%, 96%)',
  muted:             'hsl(220, 10%, 12%)',
  mutedForeground:   'hsl(220, 5%, 62%)',
  accent:            'hsl(220, 10%, 16%)',
  accentForeground:  'hsl(60, 5%, 96%)',
  destructive:       'hsl(0, 72%, 58%)',
  destructiveForeground:'hsl(0, 0%, 98%)',
  input:             'hsl(220, 10%, 22%)',
  ring:              'hsl(73, 87%, 60%)',
} as const

/** Apply alpha to any hsl(...) token — returns hsla(...) string (RN-supported). */
export function alpha(hslColor: string, a: number): string {
  // hsl(H, S%, L%) -> hsla(H, S%, L%, A)
  return hslColor.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${a})`)
}

export const colors = HSL

// ── Tailwind palette colours used in effort tags + chart accents ──────────────
// Hex values straight from Tailwind's default palette so `bg-blue-500/10` etc.
// translate exactly. Use `alpha()` on these hexes via the `withAlpha()` helper.
export const palette = {
  // MyRX brand colors (locked — see branding/BRAND.md). Use these instead
  // of palette.green/lime/emerald whenever a surface is brand-led (CTAs,
  // accept flows, brand chrome). Semantic emerald (palette.emerald) stays
  // for "save succeeded" / "data persisted" — different semantic.
  myrx: {
    lime:       '#CAF240',  // primary accent (LOCKED)
    dark:       '#121721',  // background (LOCKED)
    surface:    '#171C26',  // elevated surface (LOCKED)
    foreground: '#F4F3EF',  // text on dark (LOCKED)
  },
  blue:    { 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb' },
  amber:   { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
  emerald: { 300: '#6ee7b7', 400: '#34d399', 500: '#10b981' },
  red:     { 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
  teal:    { 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6' },
  indigo:  { 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1' },
  cyan:    { 400: '#22d3ee', 500: '#06b6d4' },
  violet:  { 400: '#a78bfa', 500: '#8b5cf6' },
  sky:     { 400: '#38bdf8', 500: '#0ea5e9' },
  slate:   { 400: '#94a3b8', 500: '#64748b' },
  fuchsia: { 400: '#e879f9', 500: '#d946ef' },
  pink:    { 400: '#f472b6', 500: '#ec4899' },
  rose:    { 400: '#fb7185', 500: '#f43f5e' },
  purple:  { 400: '#c084fc', 500: '#a855f7' },
  orange:  { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c' },
  yellow:  { 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207' },
  green:   { 400: '#4ade80', 500: '#22c55e' },
} as const

/** Apply alpha to a hex colour (#RRGGBB) → 'rgba(r,g,b,a)' — for palette use. */
export function withAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// ── Spacing scale (Tailwind default: 1 = 0.25rem = 4px) ───────────────────────
export const space = {
  px:  1,    0:   0,    0.5: 2,    1:   4,    1.5: 6,    2:   8,
  2.5: 10,   3:   12,   3.5: 14,   4:   16,   5:   20,   6:   24,
  7:   28,   8:   32,   9:   36,   10:  40,   11:  44,   12:  48,
  14:  56,   16:  64,   20:  80,   24:  96,   28:  112,  32:  128,
} as const

// ── Type scale (matches web) ──────────────────────────────────────────────────
export const fontSize = {
  '10':  10,  // text-[10px]
  '11':  11,  // text-[11px]
  xs:    12,  // text-xs
  sm:    14,  // text-sm
  base:  16,  // text-base
  lg:    18,  // text-lg
  xl:    20,  // text-xl
  '2xl': 24,  // text-2xl
  '3xl': 30,  // text-3xl
  '4xl': 36,  // text-4xl
  '6xl': 60,  // text-6xl
} as const

// ── Border radius scale (matches Tailwind config exactly) ─────────────────────
export const radius = {
  none: 0,
  sm:   3,
  DEFAULT: 6,
  md:   6,
  lg:   9,
  xl:   12,
  '2xl': 16,
  '3xl': 20,
  full: 9999,
} as const

// ── Font families ─────────────────────────────────────────────────────────────
// JetBrains Mono is loaded via `@expo-google-fonts/jetbrains-mono` in
// `app/_layout.tsx`. Each weight registers under its export key — that key is
// what RN's `fontFamily` looks up. We don't bother loading multiple sans weights
// since we lean on the system font for everything that isn't a number.
// Geist for sans (matches web's body font), JetBrainsMono for tabular
// numerics. Both register their weight variants via `useFonts({...})` in
// `app/_layout.tsx`. The React Native `fontFamily` style matches the
// Google Fonts export key exactly — no font-weight mapping involved.
//
// IMPORTANT for parity with web: any text style that relies on the system
// default (`fontFamily` unset) renders in Roboto on Android / SF on iOS,
// which looks subtly different from Geist. Reach for `fonts.sans[N]`
// instead so the surface stays consistent across web + mobile.
export const fonts = {
  sans: {
    400: 'Geist_400Regular',
    500: 'Geist_500Medium',
    600: 'Geist_600SemiBold',
    700: 'Geist_700Bold',
  },
  mono: {
    400: 'JetBrainsMono_400Regular',
    500: 'JetBrainsMono_500Medium',
    600: 'JetBrainsMono_600SemiBold',
    700: 'JetBrainsMono_700Bold',
  },
} as const
