/**
 * Dashboard — port of MyRX/src/pages/Dashboard.jsx to React Native.
 *
 * Layout matches the web 1:1:
 *   1. Profile card (animate-rise delay 0ms)
 *      ├─ Edit pencil top-right
 *      ├─ Greeting line ("Good morning,", text-xl)
 *      ├─ Avatar 80x80 + name + email + detail chips + body chips
 *      └─ Stats footer (streak / PRs / member-since), border-top
 *   2. Recent activity card (animate-rise delay 240ms)
 *      ├─ Header: "Recent activity" + "View all →"
 *      └─ merged rows (efforts + bodyweight + calories), DeleteAction on each
 *
 * Helpers (formatGreeting, computeMonthlyPRs, computeFoodLogStreak,
 * computeWeeklyWeightDiff, parseCardioBest, formatHeight, etc.)
 * are direct ports of the web functions — same inputs, same outputs.
 */

import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, Pressable, StyleSheet,
} from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import {
  Dumbbell, Activity, Weight, Apple, Heart, Moon, Droplet,
  User, Settings as SettingsIcon,
} from 'lucide-react-native'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { useAuth } from '../../src/contexts/AuthContext'
import { supabase } from '../../src/lib/supabase'
import { dataCache } from '../../src/lib/cache'
import { getEffortTags, TAG_STYLES } from '../../src/lib/effortTags'
import DeleteAction from '../../src/components/DeleteAction'
import TickerNumber from '../../src/components/TickerNumber'
import AnimateRise from '../../src/components/AnimateRise'
import InviteBanner from '../../src/components/InviteBanner'
import CoachChangeBanner from '../../src/components/CoachChangeBanner'
import Skeleton from '../../src/components/Skeleton'
import { colors, alpha, palette, withAlpha, fonts } from '../../src/theme'

// ── Tier model (mirrors RadialNav.tsx::resolveTier — single source of truth for
// which pages/pills a subscription tier unlocks). free=0 < corerx=1 < fullrx=2.
//
// Active-sub aware (T098): the FullRX comp for coach-self / a coached client is
// only live while the relevant coach subscription is active. trialing / active
// / past_due keep it (active + grace window); lapsed / suspended / cancelled
// drop to the user's own b2c tier. coach-self reads its own
// coach_subscription_status; a coached client passes `coachActive` from the
// client_has_active_coach() RPC (resolved once in AuthContext). undefined →
// assume active so the nav/pills never flash a downgrade before it lands. ───────
type Tier = 'free' | 'corerx' | 'fullrx'
const TIER_RANK: Record<Tier, number> = { free: 0, corerx: 1, fullrx: 2 }
const INACTIVE_COACH_STATUSES = ['lapsed', 'suspended', 'cancelled']
function resolveTier(p: {
  b2c_subscription_tier?: 'free' | 'corerx' | 'fullrx' | null
  coach_id?: string | null
  is_superuser?: boolean
  is_coach?: boolean
  coach_subscription_status?: string | null
} | null | undefined, coachActive?: boolean): Tier {
  if (!p) return 'free'
  if (p.is_superuser === true) return 'fullrx'
  if (p.is_coach === true)
    return INACTIVE_COACH_STATUSES.includes(p.coach_subscription_status ?? '')
      ? ((p.b2c_subscription_tier as Tier | null) ?? 'free') : 'fullrx'
  if (p.coach_id)
    return coachActive === false ? ((p.b2c_subscription_tier as Tier | null) ?? 'free') : 'fullrx'
  return (p.b2c_subscription_tier as Tier | null) ?? 'free'
}

// ── Helpers (1:1 with Dashboard.jsx) ─────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

function calcAge(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null
  const today = new Date()
  const birth = new Date(birthdate)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function formatGender(g: string | null | undefined): string | null {
  if (!g) return null
  const map: Record<string, string> = {
    male: 'Male', female: 'Female',
    'non-binary': 'Non-binary', 'prefer-not-to-say': 'Prefer not to say',
  }
  return map[g] ?? g
}

function formatDate(ts: string): string {
  const now  = new Date()
  const then = new Date(ts)
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
     new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000
  )
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// formatMemberSince was removed May 24 2026 — the "since X" footer
// chip was dropped from the dashboard per user feedback (replaced by
// food log streak + lowest HR + weekly weight diff chips).

function formatHeight(height: number | null | undefined, unit: string | null | undefined): string | null {
  if (!height) return null
  if (unit === 'imperial') {
    const total = Math.round(height)
    const ft = Math.floor(total / 12)
    const inches = total % 12
    return `${ft}'${inches}"`
  }
  return `${height} cm`
}

// ── Streak helpers ────────────────────────────────────────────────────────────
//
// `getWeekKey` + `computeWeekStreak` were removed May 24 2026 with the
// weekly training streak chip. If a week-based stat is reintroduced
// later, the helpers used to live here.

function parseEffort1RM(value: string | null | undefined): number | null {
  const m = value?.match(/Est\. 1RM (\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * Parse a cardio effort's stored value into a comparable number, plus
 * a direction flag so the caller knows whether lower or higher = better.
 * Cardio storage is heterogeneous (pace, speed, rate, time, distance)
 * so we sniff the format:
 *   • "m:ss/km", "m:ss/mi", "m:ss/500m", "m:ss/100m" → pace, lower better
 *   • everything else with a number → assume higher better (speed,
 *     floors/min, cal/min, distance, calories, etc.)
 * Returns null when no number can be extracted.
 *
 * IMPORTANT: the pace-format check uses `\b` after the unit alternation
 * to prevent false positives like "/min" matching "/mi". Without the
 * word boundary, "4.0 floors/min" (StairMill) and "12.0 cal/min" (Air
 * Bike) would be misclassified as pace and then fail the m:ss extract,
 * silently dropping those efforts from the cardio PR count. Bug fixed
 * May 24 2026 after the test account's StairMill PR went uncounted.
 */
function parseCardioBest(value: string | null | undefined): { val: number; lowerBetter: boolean } | null {
  if (!value) return null
  const isPace = /\/(km|mi|500m|100m)\b/.test(value)
  if (isPace) {
    const m = value.match(/(\d+):(\d+)/)
    if (!m) return null
    return { val: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), lowerBetter: true }
  }
  const m = value.match(/(\d+(?:\.\d+)?)/)
  return m ? { val: parseFloat(m[1]), lowerBetter: false } : null
}

/** Reusable "within the last 30 days" check (rolling window, not calendar
 *  month). Captures the cutoff at call time so multiple PR helpers running in
 *  the same render bucket consistently. */
function isWithinLast30Days(ds: string): boolean {
  const t = new Date(ds).getTime()
  return t >= Date.now() - 30 * 86_400_000
}

/**
 * Count strength PRs hit in the last 30 days (rolling window).
 *
 * For each exercise (group key = label.split(' · ')[0]), find the
 * highest-ever Est. 1RM. If that highest was logged this calendar
 * month → +1 PR for that exercise. Sums across all exercises.
 *
 * Split from the old combined computeMonthlyPRs() on May 24 2026 so
 * the dashboard can surface strength and cardio PRs as separate chips
 * (blue + amber respectively).
 */
function computeStrengthPRsThisMonth(allStrengthEfforts: any[]): number {
  let count = 0
  const byEx: Record<string, { rm: number; date: string }[]> = {}
  allStrengthEfforts.forEach(e => {
    const rm = parseEffort1RM(e.value)
    if (!rm) return
    const ex = e.label?.split(' · ')[0]
    if (!ex) return
    if (!byEx[ex]) byEx[ex] = []
    byEx[ex].push({ rm, date: e.created_at })
  })
  Object.values(byEx).forEach(arr => {
    const best = arr.reduce((b, e) => e.rm > b.rm ? e : b, arr[0])
    if (isWithinLast30Days(best.date)) count++
  })
  return count
}

/**
 * Count cardio PRs hit in the last 30 days (rolling window).
 *
 * For each activity (group key = label.split(' · ')[0]), find the
 * best-ever value. "Best" direction depends on the metric — pace-
 * style values (m:ss/km, /mi, /500m, /100m) are LOWER-is-better;
 * everything else (km/h, floors/min, cal/min, distance) is HIGHER-is-
 * better. parseCardioBest() returns the flag per effort.
 *
 * +1 PR per activity where the best ever was hit this month. Sums.
 */
function computeCardioPRsThisMonth(allCardioEfforts: any[]): number {
  let count = 0
  const byAct: Record<string, { val: number; date: string; lowerBetter: boolean }[]> = {}
  allCardioEfforts.forEach(e => {
    const parsed = parseCardioBest(e.value)
    if (!parsed) return
    const act = e.label?.split(' · ')[0]
    if (!act) return
    if (!byAct[act]) byAct[act] = []
    byAct[act].push({ val: parsed.val, date: e.created_at, lowerBetter: parsed.lowerBetter })
  })
  Object.values(byAct).forEach(arr => {
    const best = arr.reduce((b, e) => {
      if (e.lowerBetter) return e.val < b.val ? e : b
      return e.val > b.val ? e : b
    }, arr[0])
    if (isWithinLast30Days(best.date)) count++
  })
  return count
}

/**
 * Count consecutive days the user has logged food, walking backward
 * from today (or yesterday if today has no logs yet). Returns 0 when
 * the streak is broken or no logs exist. Used by the dashboard food
 * streak chip — caller decides cosmetic cap (e.g. show "14+" once
 * past 14).
 */
function computeFoodLogStreak(logDates: string[]): number {
  // Counts DISTINCT log_dates in the last 14 days (matches the chip's
  // "X days logged in last 14 days" label semantics).
  //
  // Earlier this function walked backwards counting only CONSECUTIVE
  // days — a stricter "streak" definition that reset to 0 the moment
  // the user skipped 2+ recent days, even if the rest of the 14-day
  // window had heavy activity. That contradicted the label and made
  // the chip vanish for genuinely-active users who took a weekend off
  // food-logging (locked May 26 2026 after a real-data audit on
  // Motaz's account: 10 logs across 14 days but a 3-day tail gap →
  // chip hid).
  //
  // The caller already filters its food_logs SELECT to >= today-14,
  // so we just dedupe + count.
  if (!logDates || logDates.length === 0) return 0
  return new Set(logDates).size
}

/**
 * Weight change since the previous weigh-in — the latest log minus the one
 * before it (within the window the caller fetches). Returns null when there
 * are fewer than 2 logs to compare; the caller then renders nothing — the
 * weight chip is change-only (no current-weight fallback).
 *
 * Returns the delta in CANONICAL kg; caller converts to display unit.
 */
function computeWeeklyWeightDiff(bwLogs: { weight: number; unit: string; created_at: string }[]): { deltaKg: number } | null {
  if (!bwLogs || bwLogs.length < 2) return null
  const toKg = (w: number, u: string) => u === 'lb' ? w * 0.453592 : w
  // bwLogs is sorted DESC by created_at (newest first): [0] = latest, [1] = previous.
  return { deltaKg: toKg(bwLogs[0].weight, bwLogs[0].unit) - toKg(bwLogs[1].weight, bwLogs[1].unit) }
}

// ── Sleep + hydration chip helpers (added with the Sleep/Hydration chips) ────

/** Avg sleep hours across the given sessions (duration_s). null if none. */
function computeAvgSleepHours(sessions: { duration_s: number | null }[]): number | null {
  const durs = sessions.map(s => Number(s.duration_s)).filter(d => d > 0)
  if (durs.length === 0) return null
  const avgSecs = durs.reduce((a, b) => a + b, 0) / durs.length
  return Math.round((avgSecs / 3600) * 10) / 10
}

// Beverage-Hydration-Index multiplier (mirrors the Hydration page): milk 1.5×,
// everything else 1.0×. Effective hydration = amount_ml × multiplier.
function hydrationMult(t: string): number { return t === 'milk' ? 1.5 : 1 }

/** Daily water goal in mL (35 mL/kg of latest bodyweight). 0 if no weight. */
function hydrationGoalMl(bwLogs: { weight: number; unit: string }[]): number {
  const latest = bwLogs[0]
  if (!latest?.weight) return 0
  const kg = latest.unit === 'lb' ? Number(latest.weight) * 0.453592 : Number(latest.weight)
  return kg > 0 ? Math.round(kg * 35) : 0
}

/** How many of the last-7 days the user's effective water intake hit goal. */
function computeHydrationDaysHit(
  logs: { amount_ml: number; drink_type: string; logged_at: string }[],
  goalMl: number,
): number | null {
  if (logs.length === 0 || goalMl <= 0) return null
  const byDay: Record<string, number> = {}
  for (const l of logs) {
    const d = new Date(l.logged_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    byDay[key] = (byDay[key] ?? 0) + Number(l.amount_ml) * hydrationMult(l.drink_type)
  }
  return Object.values(byDay).filter(ml => ml >= goalMl).length
}

// ── Coach info ───────────────────────────────────────────────────────────────
//
// Returned by the SECURITY DEFINER RPC `get_coach_info()` which resolves
// the caller's linked coach (profiles.coach_id), falling back to the
// admin superuser when no coach is linked. Returns NULL when neither
// exists — in which case the dashboard simply doesn't render the badge.
interface CoachInfo {
  full_name?: string | null
  avatar_url?: string | null
  last_seen_at?: string | null
  share_online_status?: boolean
}

// ── Tag chip ──────────────────────────────────────────────────────────────────

function TagChip({ label, style }: { label: string; style: any }) {
  return (
    <View style={[tc.chip, {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
    }]}>
      <Text style={[tc.text, { color: style.color }]}>{label}</Text>
    </View>
  )
}

const tc = StyleSheet.create({
  chip: { borderRadius: 9999, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 10, fontWeight: '600' },
})

// ── Activity row ──────────────────────────────────────────────────────────────

type AnyItem = {
  id: string
  _kind: 'effort' | 'weighin' | 'calorie'
  created_at: string
  type?: string
  label?: string
  value?: string
  weight?: number
  unit?: string
  calories?: number
  log_date?: string
}

function ActivityRow({ item, onDelete }: { item: AnyItem; onDelete: () => void }) {
  // ── Calorie ──
  if (item._kind === 'calorie') {
    return (
      <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
        <View style={d.rowInner}>
          <View style={[d.iconBox, { backgroundColor: withAlpha(palette.red[500], 0.10) }]}>
            <Apple size={14} color={palette.red[400]} />
          </View>
          <View style={d.rowText}>
            <Text style={d.rowLabel} numberOfLines={1}>Intake · {item.calories} kcal</Text>
            <View style={d.rowTags}>
              <TagChip label="Calories" style={TAG_STYLES.calories} />
              <TagChip label="Intake"   style={TAG_STYLES.Intake} />
              <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
            </View>
          </View>
        </View>
      </DeleteAction>
    )
  }

  // ── Weigh-in ──
  if (item._kind === 'weighin') {
    return (
      <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
        <View style={d.rowInner}>
          <View style={[d.iconBox, { backgroundColor: withAlpha(palette.emerald[500], 0.10) }]}>
            <Weight size={14} color={palette.emerald[400]} />
          </View>
          <View style={d.rowText}>
            <Text style={d.rowLabel} numberOfLines={1}>Weigh-in · {item.weight} {item.unit}</Text>
            <View style={d.rowTags}>
              <TagChip label="Bodyweight" style={TAG_STYLES.weighin} />
              <TagChip label="Weigh-in"   style={TAG_STYLES['Weigh-in']} />
              <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
            </View>
          </View>
        </View>
      </DeleteAction>
    )
  }

  // ── Effort (strength / cardio) ──
  const { primary, secondary } = getEffortTags(item as any)
  const iconBg =
    item.type === 'strength' ? withAlpha(palette.blue[500], 0.10)
  : item.type === 'cardio'   ? withAlpha(palette.amber[500], 0.10)
  : alpha(colors.primary, 0.10)
  const iconColor =
    item.type === 'strength' ? palette.blue[400]
  : item.type === 'cardio'   ? palette.amber[400]
  : colors.primary
  const Icon =
    item.type === 'strength' ? Dumbbell
  : item.type === 'cardio'   ? Activity
  : Weight

  return (
    <DeleteAction onDelete={onDelete} style={d.rowOuter} bg={colors.background}>
      <View style={d.rowInner}>
        <View style={[d.iconBox, { backgroundColor: iconBg }]}>
          <Icon size={14} color={iconColor} />
        </View>
        <View style={d.rowText}>
          <Text style={d.rowLabel} numberOfLines={1}>{item.label}</Text>
          <View style={d.rowTags}>
            <TagChip label={primary.label} style={primary.style} />
            {secondary ? <TagChip label={secondary.label} style={secondary.style} /> : null}
            <Text style={d.rowDate}>{formatDate(item.created_at)}</Text>
          </View>
        </View>
      </View>
    </DeleteAction>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, profile, coachEntitlementActive } = useAuth()

  // Subscription tier → which stat pills show (CLAUDE.md §20). free: Strength
  // + Cardio only; corerx adds Weight + Food; fullrx adds Heart + Sleep +
  // Hydration (the wellness layer).
  const tierRank = TIER_RANK[resolveTier(profile as any, coachEntitlementActive)]

  const cacheKey = user ? `dashboard:${user.id}` : null
  const cached   = cacheKey ? dataCache.get<any>(cacheKey) : null

  const [recentEfforts, setRecentEfforts]   = useState<any[]>(cached?.efforts   ?? [])
  const [recentBW, setRecentBW]             = useState<any[]>(cached?.bw        ?? [])
  const [recentCalories, setRecentCalories] = useState<any[]>(cached?.calories  ?? [])
  // Strength + cardio PRs as separate chips (May 24 2026 split). Each
  // counts "this calendar month" personal records in its own modality —
  // strength = highest Est. 1RM per exercise, cardio = best per
  // activity (direction-aware).
  const [strengthPRs, setStrengthPRs]       = useState<number | null>(cached?.strengthPrs ?? null)
  const [cardioPRs, setCardioPRs]           = useState<number | null>(cached?.cardioPrs   ?? null)
  // Stats footer chips added May 24 2026 — replaces the old training
  // streak + member-since chips with three more actionable signals:
  // food log discipline, recovery (lowest ambient HR), and weekly
  // weight movement.
  const [foodStreak, setFoodStreak]         = useState<number | null>(cached?.foodStreak ?? null)
  const [lowestHR7d, setLowestHR7d]         = useState<number | null>(cached?.lowestHR   ?? null)
  const [weeklyWeightKg, setWeeklyWeightKg] = useState<number | null>(cached?.weeklyKg   ?? null)
  // Sleep (avg hours / 7 nights) + Hydration (days hit goal / 7) chips.
  const [avgSleepH, setAvgSleepH]           = useState<number | null>(cached?.avgSleepH     ?? null)
  const [hydrationDays, setHydrationDays]   = useState<number | null>(cached?.hydrationDays ?? null)
  // "Coached by [name]" mini-badge data. Resolved via SECURITY DEFINER
  // RPC `get_coach_info()` which returns the caller's linked coach (or
  // the admin superuser fallback). Render is gated on chat_enabled +
  // non-admin/non-coach role downstream; we still fetch unconditionally
  // because the RPC is cheap and the gate may flip after this fetch.
  const [coachInfo, setCoachInfo]           = useState<CoachInfo | null>(cached?.coachInfo ?? null)
  // Initial-load loading flag — only flips true the very first time the
  // user opens the dashboard on this device (no cache yet). Subsequent
  // visits paint immediately from cache while the focus-effect refetches.
  const [loading, setLoading]               = useState<boolean>(!cached)

  // Re-fetch every time the dashboard tab gains focus (May 24 2026
  // bug fix). The previous `useEffect([user])` only ran on initial
  // mount, so newly logged efforts from other tabs never refreshed
  // the PR / streak / HR / weight chips — the user would log a
  // StairMill PR from the Cardio tab, come back to Dashboard, and
  // see the old count. Expo Router keeps tabs mounted so useEffect
  // doesn't re-fire on focus. useFocusEffect IS the right primitive.
  //
  // dataCache still provides instant paint from a prior session —
  // the fresh fetch overwrites it once Supabase responds.
  const fetchDashboard = useCallback(() => {
    if (!user) return
    // Pre-compute the windowed ISO timestamps once so each query gets
    // a stable, consistent boundary even if the user keeps the
    // dashboard open across midnight.
    const now             = Date.now()
    const sevenDaysAgoISO    = new Date(now -  7 * 86400000).toISOString()
    const fourteenDaysAgoISO = new Date(now - 14 * 86400000).toISOString()
    const thirtyDaysAgoISO   = new Date(now - 30 * 86400000).toISOString()
    const fourteenDaysAgoDay = fourteenDaysAgoISO.slice(0, 10)  // YYYY-MM-DD for food_logs.log_date

    Promise.all([
      // Recent activity feed — capped at 5 of each, sorted desc.
      supabase.from('efforts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('bodyweight').select('id, weight, unit, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('calorie_logs').select('id, log_date, calories').eq('user_id', user.id).order('log_date', { ascending: false }).limit(5),
      // PR computation — all-time efforts, split into strength / cardio
      // downstream via .type filtering.
      supabase.from('efforts').select('created_at, label, value, type').eq('user_id', user.id),
      // Food log streak — 14-day window of distinct log_dates is plenty
      // for the streak walker (caller counts consecutive days backward).
      supabase.from('food_logs').select('log_date').eq('user_id', user.id).gte('log_date', fourteenDaysAgoDay),
      // Lowest ambient HR — last 7 days, workout_id IS NULL (matches
      // the Heart page's resting-HR filter so the chip mirrors what
      // they see there).
      supabase.from('hr_samples').select('bpm').eq('user_id', user.id).is('workout_id', null).gte('measured_at', sevenDaysAgoISO),
      // Weight change — every weigh-in in the last 30 days (latest − earliest).
      supabase.from('bodyweight').select('weight, unit, created_at').eq('user_id', user.id).gte('created_at', thirtyDaysAgoISO).order('created_at', { ascending: false }),
      // Coach info — SECURITY DEFINER RPC; returns the caller's linked
      // coach or the admin superuser fallback (or null). Drives the
      // "Coached by [name]" badge in the profile card.
      supabase.rpc('get_coach_info'),
      // Sleep — last 7 nights (duration_s) for the avg-sleep chip.
      supabase.from('sleep_sessions').select('duration_s').eq('user_id', user.id).gte('start_at', sevenDaysAgoISO),
      // Hydration — last 7 days of water logs for the days-hit-goal chip.
      supabase.from('water_logs').select('amount_ml, drink_type, logged_at').eq('user_id', user.id).gte('logged_at', sevenDaysAgoISO),
    ]).then(([efRes, bwRes, calRes, allEffRes, foodLogRes, hrRes, bw30Res, coachRes, sleepRes, waterRes]) => {
      const efforts  = efRes.data  ?? []
      const bw       = bwRes.data  ?? []
      const calories = (calRes.data ?? []).map((r: any) => ({ ...r, created_at: r.log_date + 'T12:00:00' }))
      const allEff   = allEffRes.data ?? []

      // PRs split per modality (strength / cardio).
      const strengthPrsCount = computeStrengthPRsThisMonth(allEff.filter((e: any) => e.type === 'strength'))
      const cardioPrsCount   = computeCardioPRsThisMonth(allEff.filter((e: any) => e.type === 'cardio'))

      // Food log streak — distinct log_dates from the 14-day window.
      const foodDates    = Array.from(new Set((foodLogRes.data ?? []).map((r: any) => r.log_date as string)))
      const foodStreakV  = computeFoodLogStreak(foodDates)

      // Lowest ambient HR — min over the 7-day sample window.
      const hrSamples    = (hrRes.data ?? []) as { bpm: number }[]
      const lowestHRv    = hrSamples.length > 0 ? Math.min(...hrSamples.map(s => s.bpm)) : null

      // Weight change over the rolling 30-day window — latest minus earliest
      // weigh-in IN the window. null when <2 weigh-ins in 30 days; the pill
      // then shows a "no recent weight" placeholder rather than hiding (T069).
      const toKgLocal    = (w: number, u: string) => u === 'lb' ? w * 0.453592 : w
      const bw30         = (bw30Res.data ?? []) as { weight: number; unit: string; created_at: string }[]
      const weeklyKgVal  = bw30.length >= 2
        ? toKgLocal(Number(bw30[0].weight), bw30[0].unit) - toKgLocal(Number(bw30[bw30.length - 1].weight), bw30[bw30.length - 1].unit)
        : null

      // Sleep avg (hours) + hydration days-hit-goal (last 7). Goal comes from
      // the freshly-fetched bodyweight rows (35 mL/kg); chips hide on no data.
      const avgSleepV      = computeAvgSleepHours((sleepRes.data ?? []) as { duration_s: number | null }[])
      const hydrationDaysV = computeHydrationDaysHit(
        (waterRes.data ?? []) as { amount_ml: number; drink_type: string; logged_at: string }[],
        hydrationGoalMl(bw as { weight: number; unit: string }[]),
      )

      // Coach info — RPC returns NULL when neither a linked coach nor
      // an admin superuser fallback exists (self-coached and no admin
      // account). Otherwise: strip "Coach " prefix from full_name and
      // keep only the first name — matches ChatSheet's identical
      // transformation so the badge shows the same display name.
      const rawCoach = (coachRes.data ?? null) as CoachInfo | null
      let coachVal: CoachInfo | null = null
      if (rawCoach && rawCoach.full_name) {
        const firstName = rawCoach.full_name
          .replace(/^coach\s+/i, '')
          .trim()
          .split(' ')[0] ?? ''
        coachVal = { ...rawCoach, full_name: firstName }
      }

      setRecentEfforts(efforts)
      setRecentBW(bw)
      setRecentCalories(calories)
      setStrengthPRs(strengthPrsCount)
      setCardioPRs(cardioPrsCount)
      setFoodStreak(foodStreakV)
      setLowestHR7d(lowestHRv)
      setWeeklyWeightKg(weeklyKgVal)
      setCoachInfo(coachVal)
      setAvgSleepH(avgSleepV)
      setHydrationDays(hydrationDaysV)

      if (cacheKey) dataCache.set(cacheKey, {
        efforts, bw, calories,
        strengthPrs: strengthPrsCount,
        cardioPrs:   cardioPrsCount,
        foodStreak:  foodStreakV,
        lowestHR:    lowestHRv,
        weeklyKg:    weeklyKgVal,
        coachInfo:   coachVal,
        avgSleepH:     avgSleepV,
        hydrationDays: hydrationDaysV,
      })

      setLoading(false)
    })
  }, [user, cacheKey])

  // Fire on focus — every time the user navigates TO the dashboard tab,
  // including the initial mount. The returned function (none here) would
  // run on blur if we wanted to cancel an in-flight request.
  useFocusEffect(fetchDashboard)

  // Realtime coach-info refresh (locked May 29 2026).
  // AuthContext's realtime profile sub auto-refetches `profile` when
  // admin's chip flips coach_id server-side. But the "Coached by [name]"
  // badge on this page reads `coachInfo` (the resolved coach's name +
  // avatar) which is fetched separately via get_coach_info — that fetch
  // lives inside fetchDashboard, so it only fires on tab focus. Without
  // this effect, an admin-driven coach swap would update `profile.coach_id`
  // in real time (the chip would react) but the badge stayed showing the
  // previous coach until the user blurred + refocused the dashboard.
  // This effect re-runs the RPC every time coach_id changes, keeping the
  // badge in sync with the live state.
  const liveCoachId = (profile as any)?.coach_id ?? null
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    if (liveCoachId == null) {
      // Self-managed — clear the badge entirely.
      if (!cancelled) setCoachInfo(null)
      return () => { cancelled = true }
    }
    supabase.rpc('get_coach_info').then(({ data }) => {
      if (cancelled) return
      setCoachInfo((data as CoachInfo | null) ?? null)
    })
    return () => { cancelled = true }
  }, [user?.id, liveCoachId])

  // DeleteAction's tap-confirm (tap trash → red check → tap again) IS the
  // confirm step — no native Alert prompt needed. Web behaves the same way.
  async function handleDelete(item: AnyItem) {
    const table =
      item._kind === 'weighin' ? 'bodyweight'
    : item._kind === 'calorie' ? 'calorie_logs'
    : 'efforts'

    if (item._kind === 'weighin') setRecentBW(prev => prev.filter(b => b.id !== item.id))
    else if (item._kind === 'calorie') setRecentCalories(prev => prev.filter(c => c.id !== item.id))
    else setRecentEfforts(prev => prev.filter(e => e.id !== item.id))

    await supabase.from(table).delete().eq('id', item.id).eq('user_id', user!.id)

    // Recompute the pill aggregates (PRs / streak / HR / weight / hydration /
    // sleep / food) after the delete. They're computed inside fetchDashboard
    // from their own queries — NOT from the recent-activity list — so the
    // optimistic list updates above don't refresh them. Without this the pills
    // stay stale until the tab re-gains focus (useFocusEffect). fetchDashboard
    // never sets loading=true, so this refresh won't flash a skeleton.
    fetchDashboard()
  }

  // Merge + sort + cap to 5 (matches web)
  const allActivity: AnyItem[] = [
    ...recentEfforts.map(e => ({ ...e, _kind: 'effort' as const })),
    ...recentBW.map(b => ({ ...b, _kind: 'weighin' as const })),
    ...recentCalories.map(c => ({ ...c, _kind: 'calorie' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5)

  // ── Profile-derived display values ─────────────────────────────────────────
  const age           = calcAge(profile?.birthdate)
  const gender        = formatGender(profile?.gender)
  const avatarUrl     = profile?.avatar_url || null
  const displayWeight = profile?.current_weight
    ? `${profile.current_weight} ${profile.weight_unit || 'lb'}`
    : null
  const displayHeight = formatHeight(profile?.current_height, profile?.height_unit || 'imperial')

  // Format phone with country-aware spacing (e.g. "+1 555 123 4567") so
  // it matches the input shown on EditProfile / Settings.
  const phoneDisplay = profile?.phone
    ? (parsePhoneNumberFromString(profile.phone)?.formatInternational() ?? profile.phone)
    : null
  const detailChips = [gender, age != null ? `${age} yrs` : null, phoneDisplay].filter(Boolean) as string[]
  const bodyChips   = [displayWeight, displayHeight].filter(Boolean) as string[]

  // "Coached by [name]" mini-badge visibility gate. Renders only when:
  //   1. We have a resolved coach (RPC returned a row + display name)
  //   2. The viewer is NOT themselves an admin or a coach — those
  //      accounts ARE the coach, so the badge would be self-referential
  //
  // chat_enabled is INTENTIONALLY NOT a gate here (locked May 27 2026).
  // The badge reflects the coaching relationship (coach_id is set);
  // chat is an independent module the coach can toggle on/off without
  // affecting the fact that they're coaching the user. Gating the badge
  // on chat_enabled would hide the coaching relationship whenever a
  // coach disables chat, which is the wrong product model.
  const showCoachBadge =
    coachInfo != null
    && !!coachInfo.full_name
    && profile?.is_superuser !== true
    && profile?.is_coach !== true

  // Skeleton — first-paint placeholder when there's no cached data yet.
  // Heights approximate the rendered cards (profile card ~280, recent
  // activity card ~400) so the layout doesn't reflow when data lands.
  if (loading) {
    return (
      <View style={d.container}>
        <Skeleton style={{ height: 280, width: '100%', borderRadius: 12 }} />
        <Skeleton style={{ height: 400, width: '100%', borderRadius: 12 }} />
      </View>
    )
  }

  return (
    <View style={d.container}>

      {/* ── Pending coach invite banner ───────────────────────────────
          Renders only when the AuthContext has pending invites for this
          user's email. Tap → opens AcceptInviteModal with the top invite
          (most recent first per get_pending_invites_for_current_user
          ORDER BY created_at DESC). Hidden for coaches + admins (gated
          in AuthContext.fetchPendingInvites). See CLAUDE.md "Patient
          invite detection" lock for the architecture. */}
      <InviteBanner />

      {/* Coach-change banner — unified notice for assigned / detached /
          swapped coach events. Trigger on profiles.coach_id resets the
          ack column on every change so a fresh banner fires automatically.
          See mobile/src/components/CoachChangeBanner.tsx for the full
          state machine (assigned vs lost vs fresh-signup-no-show). */}
      <CoachChangeBanner />

      {/* ── Profile card ─────────────────────────────────────────────── */}
      {/* The card is wrapped in a positioning View so the edit pencil can
          float OUTSIDE the AnimateRise wrapper. AnimateRise (Reanimated's
          Animated.View) was dropping the Pressable's touches on the
          Android emulator — moving the pencil outside the animated parent
          fixes the dead tap. */}
      <View style={d.profileCardWrap}>
        <AnimateRise delay={0} style={d.card}>

        {/* Greeting line — text-xl, mb-4, leaves room for the pencil */}
        <Text style={d.greeting} numberOfLines={1}>
          {getGreeting()},
        </Text>

        <View style={d.profileRow}>
          {/* Avatar — h-20 w-20 */}
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={d.avatar} contentFit="cover" />
          ) : (
            <View style={d.avatarPlaceholder}>
              <User size={36} color={colors.primary} />
            </View>
          )}

          {/* Name + email + chips */}
          <View style={d.profileText}>
            <Text style={d.name} numberOfLines={1}>
              {profile?.full_name || user?.email?.split('@')[0] || 'Athlete'}
            </Text>
            <Text style={d.email} numberOfLines={1}>{user?.email}</Text>

            {detailChips.length > 0 && (
              <View style={d.chipsRow}>
                {detailChips.map(chip => (
                  <View key={chip} style={d.detailChip}>
                    <Text style={d.detailChipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            )}

            {bodyChips.length > 0 && (
              <View style={d.chipsRow}>
                {bodyChips.map(chip => (
                  <View key={chip} style={d.bodyChip}>
                    <Text style={d.bodyChipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Coached-by mini-badge — sits between the profile row and the
            stats border. Tiny avatar + "Coached by [FirstName]" inline
            row. Non-interactive in v1: opening the chat sheet is owned
            by the parent AppShell (uses setChatOpen) and the dashboard
            has no handle on that state, so the badge is informational
            only. Visibility gated on showCoachBadge (linked coach +
            chat enabled + non-admin/non-coach viewer). */}
        {showCoachBadge && coachInfo && (
          <View style={d.coachBadgeRow}>
            {coachInfo.avatar_url ? (
              <Image source={{ uri: coachInfo.avatar_url }} style={d.coachAvatar} contentFit="cover" />
            ) : (
              <View style={d.coachAvatarPlaceholder}>
                <Text style={d.coachAvatarInitial}>
                  {(coachInfo.full_name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={d.coachBadgeText} numberOfLines={1}>
              <Text style={d.coachBadgeMuted}>Coached by </Text>
              <Text style={d.coachBadgeName}>{(coachInfo.full_name ?? '').trim().split(' ')[0]}</Text>
            </Text>
          </View>
        )}

        {/* Stats footer — border-top.
            Locked May 24 2026: replaced the older weekly-training-streak
            + member-since chips with a 4-chip set that pulls from the
            three real data sources (efforts, food_logs, hr_samples,
            bodyweight). Every chip is gated on `value != null` so first-
            time users with no data don't see empty/placeholder chips —
            only the metrics that have data show up. */}
        <View style={d.statsRow}>
          {/* Strength PRs — FREE. Last 30 days (count; shows 0 when none). */}
          {tierRank >= TIER_RANK.free && strengthPRs != null && (
            <View style={[d.statChip, d.statChipBlue]}>
              {strengthPRs > 0 ? (
                <>
                  <Dumbbell size={12} color={palette.blue[400]} style={d.statChipIcon} />
                  <View style={d.statChipNum}>
                    <TickerNumber value={strengthPRs} fontSize={11} color={palette.blue[400]} fontWeight="700" />
                  </View>
                  <Text style={[d.statChipText, { color: palette.blue[400] }]}>
                    {' '}strength PR{strengthPRs !== 1 ? 's' : ''} · 30d
                  </Text>
                </>
              ) : (
                <>
                  <Dumbbell size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent strength PRs</Text>
                </>
              )}
            </View>
          )}

          {/* Cardio PRs — FREE. Last 30 days (count; shows 0 when none). */}
          {tierRank >= TIER_RANK.free && cardioPRs != null && (
            <View style={[d.statChip, d.statChipAmber]}>
              {cardioPRs > 0 ? (
                <>
                  <Activity size={12} color={palette.amber[400]} style={d.statChipIcon} />
                  <View style={d.statChipNum}>
                    <TickerNumber value={cardioPRs} fontSize={11} color={palette.amber[400]} fontWeight="700" />
                  </View>
                  <Text style={[d.statChipText, { color: palette.amber[400] }]}>
                    {' '}cardio PR{cardioPRs !== 1 ? 's' : ''} · 30d
                  </Text>
                </>
              ) : (
                <>
                  <Activity size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent cardio PRs</Text>
                </>
              )}
            </View>
          )}

          {/* Weight change — CORERX. Last 30 days (latest − earliest weigh-in). */}
          {tierRank >= TIER_RANK.corerx && (
            <View style={[d.statChip, d.statChipEmerald]}>
              {weeklyWeightKg != null ? (() => {
                const pUnit = profile?.weight_unit === 'kg' ? 'kg' : 'lb'
                const inUnit = pUnit === 'kg' ? weeklyWeightKg : weeklyWeightKg / 0.453592
                const rounded = Math.round(inUnit * 10) / 10
                const sign = rounded > 0.05 ? '+' : rounded < -0.05 ? '−' : ''
                const abs = Math.abs(rounded).toFixed(1)
                return (
                  <>
                    <Weight size={12} color={palette.emerald[400]} style={d.statChipIcon} />
                    <View style={d.statChipNum}>
                      <TickerNumber value={`${sign}${abs}`} fontSize={11} color={palette.emerald[400]} fontWeight="700" />
                    </View>
                    <Text style={[d.statChipText, { color: palette.emerald[400] }]}>{` ${pUnit} · 30d`}</Text>
                  </>
                )
              })() : (
                <>
                  <Weight size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent weight</Text>
                </>
              )}
            </View>
          )}

          {/* Lowest ambient HR — FULLRX (CLAUDE.md §20: Heart is the FullRX
              wellness layer, alongside Sleep + Hydration). */}
          {tierRank >= TIER_RANK.fullrx && (
            <View style={[d.statChip, d.statChipFuchsia]}>
              {lowestHR7d != null ? (
                <>
                  <Heart size={12} color={palette.fuchsia[400]} style={d.statChipIcon} />
                  <View style={d.statChipNum}>
                    <TickerNumber value={lowestHR7d} fontSize={11} color={palette.fuchsia[400]} fontWeight="700" />
                  </View>
                  <Text style={[d.statChipText, { color: palette.fuchsia[400] }]}>{' '}low bpm · 7d</Text>
                </>
              ) : (
                <>
                  <Heart size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent HR</Text>
                </>
              )}
            </View>
          )}

          {/* Food — CORERX. Distinct days logged in the last 14 (count; shows 0). */}
          {tierRank >= TIER_RANK.corerx && foodStreak != null && (
            <View style={[d.statChip, d.statChipRed]}>
              {foodStreak > 0 ? (
                <>
                  <Apple size={12} color={palette.red[400]} style={d.statChipIcon} />
                  <View style={d.statChipNum}>
                    <TickerNumber value={foodStreak} fontSize={11} color={palette.red[400]} fontWeight="700" />
                  </View>
                  <Text style={[d.statChipText, { color: palette.red[400] }]}>
                    {' '}food day{foodStreak !== 1 ? 's' : ''} · 14d
                  </Text>
                </>
              ) : (
                <>
                  <Apple size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent food</Text>
                </>
              )}
            </View>
          )}

          {/* Avg sleep — FULLRX. Last 7 nights; "no recent" when empty. */}
          {tierRank >= TIER_RANK.fullrx && (
            <View style={[d.statChip, d.statChipIndigo]}>
              {avgSleepH != null ? (
                <>
                  <Moon size={12} color={palette.indigo[400]} style={d.statChipIcon} />
                  <View style={d.statChipNum}>
                    <TickerNumber value={avgSleepH} fontSize={11} color={palette.indigo[400]} fontWeight="700" />
                  </View>
                  <Text style={[d.statChipText, { color: palette.indigo[400] }]}>{`h sleep · 7d`}</Text>
                </>
              ) : (
                <>
                  <Moon size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent sleep</Text>
                </>
              )}
            </View>
          )}

          {/* Days the water goal was hit — FULLRX. Last 7; "no recent" when empty. */}
          {tierRank >= TIER_RANK.fullrx && (
            <View style={[d.statChip, d.statChipCyan]}>
              {hydrationDays != null ? (
                <>
                  <Droplet size={12} color={palette.cyan[400]} style={d.statChipIcon} />
                  <View style={d.statChipNum}>
                    <TickerNumber value={hydrationDays} fontSize={11} color={palette.cyan[400]} fontWeight="700" />
                  </View>
                  <Text style={[d.statChipText, { color: palette.cyan[400] }]}>{` water day${hydrationDays !== 1 ? 's' : ''} · 7d`}</Text>
                </>
              ) : (
                <>
                  <Droplet size={12} color={colors.mutedForeground} style={d.statChipIcon} />
                  <Text style={[d.statChipText, { color: colors.mutedForeground }]}>no recent water</Text>
                </>
              )}
            </View>
          )}
        </View>
        </AnimateRise>

        {/* Settings gear — floats OUTSIDE the AnimateRise so its taps
            don't get swallowed by Reanimated's Animated.View on Android.
            The wrapping View is `position: relative`, so this absolute
            gear lands at the top-right of the card visually. Direct
            router.push (not Link asChild) for the most reliable nav path.
            Was a pencil pre-May-17-2026; rebranded to a gear so the
            target page reads as Settings (Account / Preferences /
            Security / Connect tabs) rather than just profile editing. */}
        <Pressable
          onPress={() => router.push('/(app)/settings' as any)}
          style={d.editBtn}
          hitSlop={16}
          accessibilityLabel="Open settings"
        >
          <SettingsIcon size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* ── Recent activity card ─────────────────────────────────────── */}
      {/* DEV-BISECT step 5: Restored ActivityRow. */}
      {/* "View all" link removed May 28 2026 — the History page was
          deleted as redundant (every domain page now exposes its own
          history view). Dashboard's recent activity stays as a quick
          glance; deeper history lives on each tracking page. */}
      <AnimateRise delay={240} style={[d.card, { padding: 0 }]}>
        <View style={d.activityHeader}>
          <Text style={d.activityTitle}>Recent activity</Text>
        </View>

        <View style={d.activityList}>
          {allActivity.map(item => (
            <ActivityRow
              key={`${item._kind}-${item.id}`}
              item={item}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </View>
      </AnimateRise>

    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const d = StyleSheet.create({
  container: { gap: 20 },

  // Card — `rounded-2xl border border-border bg-card p-6`
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    position: 'relative',
  },

  // Wraps the profile AnimateRise card + the floating edit pencil in a
  // single positioning context so the pencil can be `position: absolute`
  // OUTSIDE the AnimateRise (Reanimated's Animated.View was eating taps).
  profileCardWrap: { position: 'relative' },

  // Edit pencil — `absolute right-4 top-4 h-7 w-7 rounded-full border bg-background`
  // zIndex: 10 keeps it above the AnimateRise's content (sibling stacking).
  editBtn: {
    position: 'absolute',
    right: 16, top: 16,
    width: 28, height: 28, borderRadius: 14,
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10, elevation: 10,
  },

  // Greeting — `text-xl font-semibold tracking-tight mb-4 pr-9`
  greeting: {
    color: colors.foreground,
    fontSize: 20, fontWeight: '600',
    marginBottom: 16, paddingRight: 36,
  },

  // Profile row — `flex items-center gap-5`
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: colors.border,
  },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: alpha(colors.primary, 0.10),
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  profileText: { flex: 1, minWidth: 0 },
  name:        { color: colors.foreground, fontSize: 20, fontWeight: '600' },
  email:       { color: colors.mutedForeground, fontSize: 14, marginTop: 2 },

  // Detail chip — `rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground`
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  detailChip: {
    borderColor: colors.border, borderWidth: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 9999,
  },
  detailChipText: { color: colors.mutedForeground, fontSize: 11 },

  // Body chip — `rounded-full border border-primary/30 bg-primary/8 font-mono tabular-nums text-primary`
  bodyChip: {
    borderColor: alpha(colors.primary, 0.30), borderWidth: 1,
    backgroundColor: alpha(colors.primary, 0.08),
    paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 9999,
  },
  bodyChipText: {
    color: colors.primary, fontSize: 11,
    fontFamily: fonts.mono[400], fontVariant: ['tabular-nums'],
  },

  // Coached-by mini-badge — sits between the profile row and the stats
  // border. Small inline pill: 24-px avatar + "Coached by [FirstName]".
  // Top margin matches the stats footer's spacing so the badge feels
  // like a continuation of the profile block, not a free-floating row.
  coachBadgeRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginTop: 16,
  },
  coachAvatar: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  coachAvatarPlaceholder: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: alpha(colors.primary, 0.10),
    alignItems: 'center', justifyContent: 'center',
  },
  coachAvatarInitial: {
    color: colors.primary, fontSize: 11, fontWeight: '600',
  },
  coachBadgeText:  { fontSize: 13, flexShrink: 1 },
  coachBadgeMuted: { color: colors.mutedForeground, fontSize: 13 },
  coachBadgeName:  { color: colors.foreground,      fontSize: 13, fontWeight: '600' },

  // Stats row — `mt-5 flex flex-wrap gap-1.5 border-t border-border pt-4`
  statsRow: {
    marginTop: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: colors.border,
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    justifyContent: 'center',
  },
  // Layout A: every chip the same fixed size — two columns (48% each), so six
  // chips form 3 rows of 2 and a lone 7th centers (justifyContent: center on
  // the row). minHeight keeps them equal-height even when a label wraps.
  statChip: {
    width: '48%', minHeight: 34,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
  },
  statChipBlue:    { borderColor: withAlpha(palette.blue[500],    0.30), backgroundColor: withAlpha(palette.blue[500],    0.10) },
  statChipAmber:   { borderColor: withAlpha(palette.amber[500],   0.30), backgroundColor: withAlpha(palette.amber[500],   0.10) },
  // Added May 24 2026 for the new chip set.
  // statChipRed     — food log streak. Matches the Calories page's red accent.
  // statChipEmerald — lowest HR. Matches the Heart page's resting-HR band color.
  // statChipSlate   — weekly weight diff. Direction-agnostic; sign in the
  //                   value tells the user which way the scale moved.
  statChipRed:     { borderColor: withAlpha(palette.red[500],     0.30), backgroundColor: withAlpha(palette.red[500],     0.10) },
  statChipEmerald: { borderColor: withAlpha(palette.emerald[500], 0.30), backgroundColor: withAlpha(palette.emerald[500], 0.10) },
  statChipSlate:   { borderColor: colors.border, backgroundColor: alpha(colors.muted, 0.30) },
  statChipMuted:   { borderColor: colors.border, backgroundColor: alpha(colors.muted, 0.30) },
  statChipIndigo:  { borderColor: withAlpha(palette.indigo[500], 0.30), backgroundColor: withAlpha(palette.indigo[500], 0.10) },
  statChipCyan:    { borderColor: withAlpha(palette.cyan[500],   0.30), backgroundColor: withAlpha(palette.cyan[500],   0.10) },
  // Heart chip — fuchsia, kept distinct from the weight pill's emerald (the
  // Bodyweight page's accent green) so the two don't read as the same colour.
  statChipFuchsia: { borderColor: withAlpha(palette.fuchsia[500], 0.30), backgroundColor: withAlpha(palette.fuchsia[500], 0.10) },
  statChipIcon:  { marginRight: 4 },
  statChipEmoji: { fontSize: 11, marginRight: 4 },
  statChipNum:   { marginRight: 0 },
  statChipText:  { fontSize: 11, fontWeight: '500' },

  // Activity card header — `flex items-center justify-between border-b px-5 py-3.5`
  activityHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  activityTitle: { color: colors.foreground, fontSize: 14, fontWeight: '600' },

  // Empty state — `px-5 py-10 text-center`
  emptyWrap:  { paddingHorizontal: 20, paddingVertical: 40, alignItems: 'center' },
  emptyText:  { color: colors.mutedForeground, fontSize: 14 },
  emptyCta:   { color: colors.primary, fontSize: 14, fontWeight: '500', marginTop: 12 },

  // Activity list — `p-3 space-y-2`
  activityList: { padding: 12, gap: 8 },

  // Activity row — `rounded-xl border border-border` outer; `flex items-center gap-3 px-4 py-3` inner
  rowOuter: {
    borderColor: colors.border, borderWidth: 1, borderRadius: 12,
  },
  rowInner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText:  { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  rowTags:  { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  rowDate:  { color: colors.mutedForeground, fontSize: 11 },
})
