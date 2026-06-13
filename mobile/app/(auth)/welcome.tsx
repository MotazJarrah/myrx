/**
 * Welcome — first-launch intro carousel for the mobile app.
 *
 * 3 swipeable slides, each full-bleed:
 *   1. Hero        — logo + tagline + subheadline
 *   2. Workout     — mini bench-press 1RM projection preview card
 *   3. Coaching    — lesson card + coach chat bubble preview
 *
 * The CTA pair ("Start your journey" / "I have an account") sits at the
 * bottom of every slide so the user can exit at any swipe — Strava-style.
 *
 * The carousel is the canonical "you are signed out" landing screen.
 * Tapping either CTA routes to /sign-in or /sign-up; signing out from
 * inside the app brings the user back here. There's no "seen-once" flag
 * — every signed-out launch lands on welcome so both paths
 * (sign in / create account) are always one tap away.
 *
 * Visual language mirrors web's MyRX/src/pages/Landing.jsx — dark
 * background, electric-lime primary, ambient-grid backdrop, radial
 * gradient glow blobs in corners. Marketing-page-on-mobile would be a
 * waste; this is the modern fitness-app pattern (Whoop / Oura / Strava).
 */

import { useEffect, useRef, useState } from 'react'
import {
  View, Text, Image, Pressable, StyleSheet, FlatList, Dimensions,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence,
  withTiming, withDelay, Easing,
} from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Stop, Rect, Line, G } from 'react-native-svg'
import { ArrowRight, Dumbbell, BookOpen, MessageCircle } from 'lucide-react-native'
import { colors, alpha, palette, fonts } from '../../src/theme'
import AnimateRise from '../../src/components/AnimateRise'
import Wordmark from '../../src/components/Wordmark'
import { useAuth } from '../../src/contexts/AuthContext'

// How long each slide stays before auto-advancing. 3.5 s — long enough to
// read the eyebrow + headline + preview at a glance, short enough to keep
// the user moving. Mirrors what feels right on Whoop / Strava onboarding.
const AUTO_ADVANCE_MS = 3500

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

// ── Backdrop ───────────────────────────────────────────────────────────────
// Ambient grid (faint vertical + horizontal lines) plus two radial-gradient
// glow blobs (lime top-left, sky-blue top-right). Static SVG — no need for
// reanimated, this is a one-shot decorative layer.
function Backdrop() {
  const cols = 12
  const rows = 24
  const cellW = SCREEN_W / cols
  const cellH = SCREEN_H / rows
  return (
    <Svg
      width={SCREEN_W}
      height={SCREEN_H}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id="lime" cx="20%" cy="10%" rx="60%" ry="60%">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.35" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="sky" cx="85%" cy="20%" rx="55%" ry="55%">
          <Stop offset="0" stopColor={palette.blue[500]} stopOpacity="0.20" />
          <Stop offset="1" stopColor={palette.blue[500]} stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <Rect x="0" y="0" width={SCREEN_W} height={SCREEN_H} fill="url(#lime)" />
      <Rect x="0" y="0" width={SCREEN_W} height={SCREEN_H} fill="url(#sky)" />

      {/* Faint grid */}
      <G opacity={0.08}>
        {Array.from({ length: cols + 1 }).map((_, i) => (
          <Line
            key={`v${i}`}
            x1={i * cellW}
            y1={0}
            x2={i * cellW}
            y2={SCREEN_H}
            stroke={colors.foreground}
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: rows + 1 }).map((_, i) => (
          <Line
            key={`h${i}`}
            x1={0}
            y1={i * cellH}
            x2={SCREEN_W}
            y2={i * cellH}
            stroke={colors.foreground}
            strokeWidth={0.5}
          />
        ))}
      </G>
    </Svg>
  )
}

// ── Pulsing badge dot ──────────────────────────────────────────────────────
// Mirrors web Landing's `<span className="animate-ping" />` — an outer
// expanding ring at low opacity sits behind a static inner dot. On web the
// ring uses the `animate-ping` Tailwind keyframes (scale 0→2.25, opacity
// 1→0, 1 s duration, ease-out). Here we drive the same effect with
// reanimated so the ring breathes on the JS-thread-free UI thread.
function PulseDot() {
  const scale   = useSharedValue(1)
  const opacity = useSharedValue(0.6)
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(2.25, { duration: 1000, easing: Easing.out(Easing.cubic) }),
        withTiming(1,    { duration: 0    }),
      ),
      -1,
      false,
    )
    opacity.value = withRepeat(
      withSequence(
        withTiming(0,   { duration: 1000, easing: Easing.out(Easing.cubic) }),
        withTiming(0.6, { duration: 0 }),
      ),
      -1,
      false,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }))

  return (
    <View style={s.badgeDot}>
      <Animated.View style={[s.badgeDotRing, ringStyle]} />
      <View style={s.badgeDotInner} />
    </View>
  )
}

// ── Slide 1: Hero ──────────────────────────────────────────────────────────
function SlideHero() {
  return (
    <View style={s.slide}>
      <AnimateRise>
        <Wordmark style={{ marginBottom: 8 }} />
      </AnimateRise>

      <AnimateRise delay={60}>
        <View style={s.badge}>
          <PulseDot />
          <Text style={s.badgeText}>Performance Lab · v1.1</Text>
        </View>
      </AnimateRise>

      <AnimateRise delay={120}>
        <Text style={s.headline}>
          Your coach. Your data.{'\n'}
          <Text style={s.headlineAccent}>Your next step.</Text>
        </Text>
      </AnimateRise>

      <AnimateRise delay={180}>
        <Text style={s.subheadline}>
          Coaching, training, and nutrition in one app — built around your next step.
        </Text>
      </AnimateRise>
    </View>
  )
}

// ── Slide 2: Workout proof ─────────────────────────────────────────────────
// Mini preview card — same data shape as web Landing's Preview card so the
// brand feels continuous. 1RM-through-10RM projection grid for a classic
// 225 lb × 5 bench press, with the user's actual set (row 5) and the
// estimated 1RM highlighted.
function SlideWorkout() {
  const rows = [
    { r: 1,  w: 260, hi: true  },
    { r: 2,  w: 247, hi: false },
    { r: 3,  w: 238, hi: false },
    { r: 4,  w: 231, hi: false },
    { r: 5,  w: 225, hi: true  },
    { r: 6,  w: 219, hi: false },
    { r: 7,  w: 214, hi: false },
    { r: 8,  w: 208, hi: false },
    { r: 9,  w: 203, hi: false },
    { r: 10, w: 199, hi: false },
  ]
  return (
    <View style={s.slide}>
      <AnimateRise>
        <Text style={s.slideEyebrow}>Every set, projected.</Text>
      </AnimateRise>

      <AnimateRise delay={60}>
        <Text style={s.slideHeadline}>
          1RM through 10RM,{'\n'}
          <Text style={s.headlineAccent}>from any set you log.</Text>
        </Text>
      </AnimateRise>

      <AnimateRise delay={120}>
        <View style={s.previewCard}>
          {/* Header row: set + est 1RM badge */}
          <View style={s.previewHeader}>
            <View style={s.previewHeaderLeft}>
              <Dumbbell size={16} color={colors.primary} />
              <Text style={s.previewHeaderText}>Bench · 225 × 5</Text>
            </View>
            <View style={s.estPill}>
              <Text style={s.estPillText}>Est. 1RM 260 lb</Text>
            </View>
          </View>

          {/* 5×2 grid of RM projections */}
          <View style={s.rmGrid}>
            {rows.map(row => (
              <View
                key={row.r}
                style={[s.rmCell, row.hi ? s.rmCellHi : s.rmCellIdle]}
              >
                <Text style={[s.rmCellLabel, row.hi ? s.rmCellLabelHi : null]}>
                  {row.r}RM
                </Text>
                <Text style={[s.rmCellValue, row.hi ? s.rmCellValueHi : null]}>
                  {row.w}
                </Text>
              </View>
            ))}
          </View>

          <View style={s.previewFooter}>
            <Text style={s.previewFooterText}>
              Epley · Brzycki · Lombardi averaged
            </Text>
            <Text style={s.previewFooterUnit}>lb</Text>
          </View>
        </View>
      </AnimateRise>
    </View>
  )
}

// ── Slide 3: Coaching proof ────────────────────────────────────────────────
// Lesson card stacked over a coach chat bubble preview. Demonstrates two
// of the highest-leverage features (daily lessons + coach messaging) in
// one glance.
function SlideCoaching() {
  return (
    <View style={s.slide}>
      <AnimateRise>
        <Text style={s.slideEyebrow}>Coached. Daily.</Text>
      </AnimateRise>

      <AnimateRise delay={60}>
        <Text style={s.slideHeadline}>
          A coach in your pocket.{'\n'}
          <Text style={s.headlineAccent}>A lesson every morning.</Text>
        </Text>
      </AnimateRise>

      <AnimateRise delay={120}>
        <View style={s.lessonCard}>
          <View style={s.lessonIconWrap}>
            <BookOpen size={16} color={colors.primary} />
          </View>
          <View style={s.lessonBody}>
            <Text style={s.lessonEyebrow}>Today's lesson · Day 12</Text>
            <Text style={s.lessonTitle}>The all-or-nothing trap</Text>
            <Text style={s.lessonMeta}>3 cards · 2 min read</Text>
          </View>
        </View>
      </AnimateRise>

      <AnimateRise delay={180}>
        <View style={s.chatRow}>
          <View style={s.coachAvatar}>
            <MessageCircle size={14} color={colors.primary} />
          </View>
          <View style={s.chatBubble}>
            <Text style={s.chatBubbleSender}>Coach Rachel</Text>
            <Text style={s.chatBubbleText}>
              Nice work this week — you hit a new PR on bench. Let's talk
              progression for next cycle.
            </Text>
          </View>
        </View>
      </AnimateRise>
    </View>
  )
}

const SLIDES = [
  { key: 'hero',     render: () => <SlideHero     /> },
  { key: 'workout',  render: () => <SlideWorkout  /> },
  { key: 'coaching', render: () => <SlideCoaching /> },
]

// ── Welcome screen ────────────────────────────────────────────────────────

export default function Welcome() {
  const insets = useSafeAreaInsets()
  const [page, setPage] = useState(0)
  const listRef = useRef<FlatList>(null)

  // "Has this device been used to sign in before?" auto-redirect.
  //
  // The welcome carousel is the brand intro for FIRST-TIME users
  // — anyone who's already created an account on this device
  // shouldn't have to swipe through three slides of marketing every
  // launch. We use the BIO_EMAIL_KEY signal (any biometric enrollment
  // attempt sets it) as proxy for "an account exists on this
  // device." If true AND there's no active session, route directly
  // to /sign-in so they can authenticate. The (auth) layout already
  // handles the active-session case (redirects to /(app)/dashboard
  // when onboarding is complete), so this only fires for signed-out
  // returning users.
  //
  // Users who never enrolled biometric (skipped that step) fall
  // through to the carousel — we have no per-device signal that
  // they have an account, so the welcome path is the same as a
  // brand-new device. Better to show extra friction once than to
  // accidentally skip the "I have an account" path for a fresh user.
  // `?skipRedirect=1` is set by the back arrow on /sign-in to break
  // the welcome→sign-in→back→welcome→sign-in loop a returning user
  // would otherwise be stuck in. When the param is present we
  // render the carousel even if the device has biometric saved.
  // The flag is per-navigation (not persisted) so the next cold
  // launch re-applies the redirect.
  const params = useLocalSearchParams<{ skipRedirect?: string }>()
  const skipRedirect = params.skipRedirect === '1'

  const { user, loading: authLoading, isBiometricEnabled } = useAuth()
  useEffect(() => {
    if (skipRedirect) return    // user explicitly back-navigated here
    if (authLoading) return
    if (user) return // active session — (auth) layout handles routing
    let cancelled = false
    ;(async () => {
      const enabled = await isBiometricEnabled()
      if (cancelled) return
      if (enabled) {
        router.replace('/(auth)/sign-in' as any)
      }
    })()
    return () => { cancelled = true }
  }, [authLoading, user, isBiometricEnabled, skipRedirect])

  // Pause auto-advance once the user manually swipes / scrolls — they're in
  // control now, no need to keep moving for them. Same pattern Strava uses.
  const [autoPlay, setAutoPlay] = useState(true)

  // Auto-advance ticker: every AUTO_ADVANCE_MS, jump to the next slide. Stop
  // at the last slide (don't loop back to slide 0 — would feel weird if the
  // user is still considering the CTA). Resets when `page` changes too,
  // so a manual swipe naturally extends the timer for the new slide.
  useEffect(() => {
    if (!autoPlay) return
    if (page >= SLIDES.length - 1) return
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: page + 1, animated: true })
    }, AUTO_ADVANCE_MS)
    return () => clearTimeout(t)
  }, [page, autoPlay])

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = e.nativeEvent.contentOffset.x
    const next = Math.round(x / SCREEN_W)
    if (next !== page) setPage(next)
  }

  // Any deliberate user touch on the carousel disables auto-advance.
  function onScrollBeginDrag() {
    setAutoPlay(false)
  }

  function go(target: '/sign-up' | '/sign-in') {
    if (target === '/sign-in') {
      // Mark this navigation as a deliberate "I have an account"
      // tap. /sign-in reads `intent=signin` to decide whether to
      // auto-trigger biometric. A bare /sign-in (e.g. from sign-out
      // or the welcome auto-redirect) skips the auto-trigger so the
      // user can opt to type a password or use a different account.
      router.replace({
        pathname: '/(auth)/sign-in' as any,
        params: { intent: 'signin' },
      })
      return
    }
    router.replace('/(auth)/sign-up' as any)
  }

  // Compute bottom inset for the CTA wrap so it never collides with the
  // Android system gesture nav (the back/home/recents pill or buttons).
  // Floor of 24 keeps it visually balanced even when insets.bottom is 0
  // (older Android with fixed navbar).
  const ctaBottom = Math.max(insets.bottom + 16, 32)

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <Backdrop />

      {/* Slides */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.key}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_W }}>
            {item.render()}
          </View>
        )}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        scrollEventThrottle={16}
        bounces={false}
        style={s.list}
      />

      {/* Pagination dots — sit ABOVE the CTA pair so they're always visible.
          Bottom offset = CTA bottom + CTA height (~118 px = 48+44+gap+text)
          + 16 px breathing room. */}
      <View style={[s.dotsRow, { bottom: ctaBottom + 132 }]}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[s.dot, i === page ? s.dotActive : s.dotIdle]}
          />
        ))}
      </View>

      {/* CTA pair — pinned to bottom but lifted clear of the system gesture
          nav via `ctaBottom`. */}
      <View style={[s.ctaWrap, { bottom: ctaBottom }]}>
        <Pressable
          onPress={() => go('/sign-up')}
          style={s.primaryBtn}
          hitSlop={8}
        >
          <Text style={s.primaryBtnText}>Create an account</Text>
        </Pressable>
        <Pressable
          onPress={() => go('/sign-in')}
          style={s.secondaryBtn}
          hitSlop={8}
        >
          <Text style={s.secondaryBtnText}>I have an account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
  },

  slide: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    // Leave room for dots + CTA pair (≈ 220 px from the bottom edge in
    // practice). The exact CTA position is computed at runtime via
    // safe-area insets — slides only need a generous lower-bound.
    paddingBottom: 240,
    gap: 18,
  },

  // ── Hero slide ─────────────────────────────────────────────────────────
  // Logo source is myrx-wordmark-dark.png (no slogan). Native dimensions
  // are 1781×390 → aspect ratio ≈ 4.57. At height 36, width = 36 * 4.57 ≈ 165.
  logo: {
    height: 36,
    width: 165,
    marginBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.5),
  },
  // Container for the pulsing dot. The ring is absolutely positioned inside
  // so its scale animation doesn't push the inner dot or the badge text.
  badgeDot: {
    width: 8, height: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeDotRing: {
    position: 'absolute',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.primary,
  },
  badgeDotInner: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary,
  },
  badgeText: { color: colors.mutedForeground, fontSize: 11 },

  headline: {
    color: colors.foreground,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '600',
    letterSpacing: -1,
    marginTop: 8,
  },
  headlineAccent: { color: colors.primary },
  subheadline: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },

  // ── Slide eyebrows / headlines for slides 2+3 ──────────────────────────
  slideEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  slideHeadline: {
    color: colors.foreground,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.5,
    marginBottom: 16,
  },

  // ── Workout preview card (slide 2) ─────────────────────────────────────
  previewCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.7),
    padding: 16,
    gap: 12,
  },
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  previewHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewHeaderText: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  estPill: {
    backgroundColor: alpha(colors.primary, 0.15),
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 999,
  },
  estPillText: { color: colors.primary, fontSize: 11, fontWeight: '600' },

  rmGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  rmCell: {
    width: '18.5%',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rmCellIdle: {
    borderColor: alpha(colors.border, 0.7),
    backgroundColor: alpha(colors.card, 0.4),
  },
  rmCellHi: {
    borderColor: alpha(colors.primary, 0.5),
    backgroundColor: alpha(colors.primary, 0.10),
  },
  rmCellLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.mutedForeground,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  rmCellLabelHi: { color: colors.foreground, opacity: 0.8 },
  rmCellValue: {
    fontFamily: fonts.mono[400],
    fontSize: 13,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  rmCellValueHi: { color: colors.foreground, fontWeight: '600' },

  previewFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  previewFooterText: { color: colors.mutedForeground, fontSize: 11 },
  previewFooterUnit: {
    color: colors.mutedForeground, fontSize: 11,
    fontFamily: fonts.mono[400],
  },

  // ── Coaching previews (slide 3) ────────────────────────────────────────
  lessonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.7),
  },
  lessonIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: alpha(colors.primary, 0.15),
    alignItems: 'center', justifyContent: 'center',
  },
  lessonBody: { flex: 1, gap: 2 },
  lessonEyebrow: {
    color: colors.primary, fontSize: 10, fontWeight: '600',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  lessonTitle: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  lessonMeta:  { color: colors.mutedForeground, fontSize: 12 },

  chatRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  coachAvatar: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.primary, 0.10),
    alignItems: 'center', justifyContent: 'center',
  },
  chatBubble: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: alpha(colors.card, 0.7),
    gap: 4,
  },
  chatBubbleSender: { color: colors.primary, fontSize: 11, fontWeight: '600' },
  chatBubbleText: { color: colors.foreground, fontSize: 13, lineHeight: 19 },

  // ── Pagination dots ────────────────────────────────────────────────────
  // `bottom` is computed at runtime from the safe-area inset so the dots
  // sit above the CTA pair regardless of the device's gesture-nav height.
  dotsRow: {
    position: 'absolute',
    left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { height: 6, borderRadius: 3 },
  dotIdle:   { width: 6,  backgroundColor: alpha(colors.foreground, 0.20) },
  dotActive: { width: 18, backgroundColor: colors.primary },

  // ── CTA pair ───────────────────────────────────────────────────────────
  // `bottom` is set inline based on `useSafeAreaInsets().bottom` so the
  // primary button never sits underneath the system gesture nav.
  ctaWrap: {
    position: 'absolute',
    left: 28, right: 28,
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '500',
  },
})
