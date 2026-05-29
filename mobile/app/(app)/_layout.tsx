/**
 * AppShell — port of MyRX/src/components/Navbar.jsx mobile layout.
 *
 * Web mobile shell (md:hidden branch):
 *   – Top bar:  fixed, h-14, border-b, bg-background/90, logo left, signout right
 *   – Bottom nav: fixed, border-t, bg-background/95, 7 items overflow-x-auto
 *   – Main:     pt-14 pb-24 with p-4 padding
 *
 * RN equivalent uses a flex column with the top bar and bottom nav as inline
 * fixed-height regions and <Slot/> rendering the active route in between.
 *
 * Authenticated guard: redirects unauthenticated users to /(auth)/sign-in.
 */

import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Slot, Redirect, usePathname, router } from 'expo-router'
import {
  LogOut, Lightbulb, MessageCircle,
} from 'lucide-react-native'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import ChatSheet from '../../src/components/ChatSheet'
import SuggestionSheet from '../../src/components/SuggestionSheet'
import { BiometricLockGate } from '../../src/components/BiometricLockGate'
import ReactivationGate from '../../src/components/ReactivationGate'
import RadialNav from '../../src/components/RadialNav'
import { colors, alpha, palette } from '../../src/theme'
import { isProfileComplete } from '../../src/lib/profile'
import { shellScrollRef } from '../../src/lib/shellScroll'
import { ChartTooltipProvider } from '../../src/lib/chartTooltipScope'

// Nav config used to live here as NAV_LINKS + a horizontal-scrolling
// BottomNav. RadialNav owns the entire bottom nav surface now — both
// were removed May 28 2026 as dead code. The canonical "what pages exist
// and which tier unlocks them" data is in mobile/src/components/RadialNav.tsx.

// ── Logo ─────────────────────────────────────────────────────────────────────
// Dark-theme full wordmark — matches web Navbar's `theme === 'dark' ?` branch.
// Source is 6000×3690 PNG; resizeMode 'contain' keeps the aspect ratio when
// height-constrained. Tapping returns the user to Dashboard (same as web).
// Uses the no-slogan wordmark — the slogan version is reserved for the
// signup welcome screen as a one-shot brand intro. Mirrors web's Navbar +
// Landing convention.
const LOGO_DARK = require('../../assets/myrx-wordmark-dark.png')

function Logo() {
  return (
    <Pressable onPress={() => router.replace('/(app)/dashboard' as any)} hitSlop={6}>
      <Image source={LOGO_DARK} style={s.logoImg} resizeMode="contain" />
    </Pressable>
  )
}

// ── Top bar ──────────────────────────────────────────────────────────────────
function TopBar({
  isAdmin, chatEnabled, unread, onSuggest, onChat, onSignOut,
}: {
  isAdmin: boolean
  chatEnabled: boolean
  unread: number
  onSuggest: () => void
  onChat: () => void
  onSignOut: () => void
}) {
  return (
    <View style={s.topBar}>
      <Logo />
      <View style={s.topBarRight}>
        {!isAdmin && (
          <Pressable onPress={onSuggest} style={s.iconBtnAmber}>
            <Lightbulb size={16} color={palette.amber[500]} />
          </Pressable>
        )}
        {chatEnabled && (
          <Pressable onPress={onChat} style={s.iconBtnPrimary}>
            <MessageCircle size={16} color={colors.primary} />
            {unread > 0 && (
              <View style={s.unreadBadge}>
                <Text style={s.unreadBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </Pressable>
        )}
        <Pressable onPress={onSignOut} style={s.iconBtnDestructive}>
          <LogOut size={16} color={colors.destructive} />
        </Pressable>
      </View>
    </View>
  )
}

// ── Main shell ───────────────────────────────────────────────────────────────
export default function AppShellLayout() {
  const { user, profile, loading, profileLoading, signOut } = useAuth()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [chatOpen,    setChatOpen]    = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)

  // Scroll-to-top on every route change. The shell mounts ONE shared
  // <ScrollView> that wraps every page via <Slot/>, so its scroll position
  // would otherwise persist across navigations — opening any deep page
  // would land you wherever the previous page had scrolled to. This effect
  // resets the scroll to 0 the instant the pathname changes.
  //
  // The ref is hoisted to a module-level singleton (`shellScrollRef` from
  // `lib/shellScroll`) so child routes can also scroll the shell to top
  // imperatively — e.g. deleting the last effort of a Sled Work variant
  // collapses the page from PUSH+DRAG to DRAG-only; the user wants to see
  // the new DRAG header at the top, not stay scrolled where the effort
  // list was. Pages call `scrollShellToTop()` from the shared lib.
  useEffect(() => {
    shellScrollRef.current?.scrollTo({ x: 0, y: 0, animated: false })
  }, [pathname])

  // Match web: chat enabled flag from profile
  const chatEnabled = (profile as any)?.chat_enabled === true
  const isAdmin     = (profile as any)?.is_superuser === true

  // ── Unread message subscription (mirrors web Navbar useEffect) ──────────────
  useEffect(() => {
    if (!user || !chatEnabled) return
    let mounted = true

    async function fetchUnread() {
      // is_suggestion=false: suggestions are handled by SuggestionSheet
      // and have their own routing; if a coach sends a suggestion, it
      // shouldn't bump the chat badge.
      // deleted_at IS NULL: soft-deleted messages don't count. Defensive
      // — the soft-delete RPC doesn't currently leave them unread, but
      // if it ever does the badge would silently leak.
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('from_admin', true)
        .eq('read', false)
        .eq('is_suggestion', false)
        .is('deleted_at', null)
      if (mounted) setUnread(count ?? 0)
    }
    fetchUnread()

    const channel = supabase
      .channel(`unread-client-${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `user_id=eq.${user.id}` },
        () => fetchUnread()
      )
      .subscribe()

    return () => { mounted = false; supabase.removeChannel(channel) }
  }, [user, chatEnabled])

  // Show the spinner ONLY during the initial load (no profile yet).
  // Subsequent profile refreshes (e.g. after `refreshProfile()` post-save)
  // also flip `profileLoading=true`, but we already have profile data to
  // render — switching to the spinner would unmount the entire route
  // tree (the <Slot /> below) and reset page-level state (scroll position,
  // active tab, form inputs). That unmount is what made the Settings
  // page appear to "redirect" to another route after Save. Mirrors web's
  // ProtectedLayout guard in MyRX/src/App.jsx.
  if (loading || (!profile && profileLoading)) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }
  if (!user) return <Redirect href={'/(auth)/sign-in' as any} />
  // User is authenticated but the profile row is missing required fields.
  // Bounce them back to sign-up — the journey reads sessionStorage state
  // and resumes from where they left off. Gate is on full_name + gender +
  // birthdate + current_weight + current_height (see isProfileComplete);
  // phone + avatar are not strictly required.
  if (!isProfileComplete(profile)) return <Redirect href={'/(auth)/sign-up' as any} />

  // Anonymized terminal-state gate (locked May 28 2026). If the account
  // was anonymized server-side (admin fired anonymize_account_now, or
  // the nightly cron expired a 30-day grace window), the profile's
  // anonymized_at flips non-null AND auth.users.banned_until is 2099.
  // AuthContext's auto-signout effect catches this via the Realtime
  // subscription and triggers signOut() — but there's a brief window
  // (the time between Realtime delivering the UPDATE and signOut()
  // tearing down the session) where this layout would otherwise render
  // a "Deleted User" dashboard. Bounce to sign-in immediately as a
  // belt-and-suspenders defence against that race.
  if ((profile as any)?.anonymized_at) {
    return <Redirect href={'/(auth)/sign-in' as any} />
  }

  // Scheduled-for-deletion gate (locked May 28 2026). During the 30-day
  // grace period the athlete CAN authenticate (Supabase auth still works)
  // but every protected route renders the reactivation gate instead of
  // the normal AppShell. Reactivate → cancel_scheduled_deletion RPC →
  // AuthContext refreshes profile → scheduled_for_deletion_at clears →
  // this gate unmounts → normal shell renders. Mirrors the web
  // CoachProtectedLayout gate (web/src/App.jsx) so coach + athlete have
  // identical deletion-grace behaviour.
  if ((profile as any)?.scheduled_for_deletion_at) {
    return <ReactivationGate />
  }

  return (
    <BiometricLockGate>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.container}>
          <TopBar
            isAdmin={isAdmin}
            chatEnabled={chatEnabled}
            unread={unread}
            onSuggest={() => setSuggestOpen(true)}
            onChat={() => setChatOpen(true)}
            onSignOut={async () => {
              await signOut()
              router.replace('/(auth)/sign-in')
            }}
          />

          <ScrollView
            ref={shellScrollRef}
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
            // "handled" = taps on touchables fire even when the keyboard is up
            // (otherwise the first tap on a dropdown row would just dismiss the
            // keyboard and lose the press). Required for MovementSearch + future
            // inline overlays.
            keyboardShouldPersistTaps="handled"
            // Required on Android API 21+ so that nested ScrollViews inside the
            // page (notably MovementSearch's dropdown) can claim vertical scroll
            // gestures instead of the parent stealing them.
            nestedScrollEnabled
          >
            {/* Wraps every page in a global "tap anywhere to dismiss pinned
                chart tooltips" scope. Charts (LineChart, HrRangeChart)
                register their dismiss handlers via useRegisterChartDismiss
                and call markChartTouch() on press-in so their own taps
                don't unpin the tooltip they just pinned. */}
            <ChartTooltipProvider>
              <Slot />
            </ChartTooltipProvider>
          </ScrollView>

          {/* RadialNav replaces the horizontal scrolling BottomNav
              (May 24 2026). Press-and-hold the center button to bloom
              a half-circle starburst of the other 7 nav pages; slide
              to highlight; release on icon to navigate or in empty
              space to cancel. See mobile/src/components/RadialNav.tsx
              for the gesture + animation contract. */}
          <RadialNav />
        </View>

        {/* Sheets — mount once at the shell so they persist across page navigations */}
        <ChatSheet       isOpen={chatOpen}    onClose={() => setChatOpen(false)} />
        <SuggestionSheet isOpen={suggestOpen} onClose={() => setSuggestOpen(false)} />
      </SafeAreaView>
    </BiometricLockGate>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  loading:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  // Top bar — matches web's `h-14 border-b border-border bg-background/90`
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: alpha(colors.background, 0.9),
  },
  // No-slogan wordmark — myrx-wordmark-dark.png is 1781×390 (aspect ≈4.57:1).
  // We give an explicit width budget so the top bar's space-between layout
  // doesn't collapse the auto-sized Image.
  logoImg: {
    height: 28,
    width: Math.round(28 * (1781 / 390)),  // ≈128
  },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  // Icon buttons (top-right) — match web's `h-9 w-9 rounded-full border-2 …`
  iconBtnAmber: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: '#f59e0b',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnPrimary: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  iconBtnDestructive: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: colors.destructive,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 16, height: 16, paddingHorizontal: 3,
    borderRadius: 8, backgroundColor: colors.destructive,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  // Scroll container — matches web's `pt-14 pb-24 p-4 max-w-6xl`
  scroll:        { flex: 1 },
  // paddingBottom = 80 so the last visible content row can scroll
  // past the floating nav's half-moon dome (idle dome top sits 60px
  // above page bottom; +20 breathing room). Without this, items
  // near the bottom-centre get covered by the dome's footprint.
  scrollContent: { padding: 16, paddingBottom: 80 },
})
