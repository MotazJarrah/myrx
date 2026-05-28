/**
 * Coach Platform v1 — shared plan constants.
 *
 * Single source of truth for tier prices, features, and pricing helpers.
 * Imported by ForCoaches.jsx (marketing landing), CoachPricing.jsx
 * (dedicated pricing page), and CoachSignup.jsx (signup flow's PlanScreen).
 *
 * Mirrors the locks in CLAUDE.md sections 18-20 (Billing model + Coach
 * tier prices + Public tier prices). If anything here changes, update
 * the same values in CLAUDE.md to keep the spec in sync.
 */

// Three coach tiers — Starter / Pro / Elite. Client cap differentiates,
// everything else is identical across tiers. Annual = 17% off year 1
// only (≈ 2 months free); renews at full monthly × 12 from year 2.
export const COACH_TIERS = [
  { id: 'starter', name: 'Starter', cap: 'Up to 10 clients',  monthly: 19, annual: 189 },
  { id: 'pro',     name: 'Pro',     cap: 'Up to 25 clients',  monthly: 39, annual: 389, recommended: true },
  { id: 'elite',   name: 'Elite',   cap: 'Unlimited clients', monthly: 99, annual: 989 },
]

// Renewal price at full annual rate (monthly × 12) — shown alongside
// year-1 promo price so year-2 isn't a surprise. CLAUDE.md §18 explicitly
// requires "first year" copy on every annual price quote.
export const renewalAnnual = (monthly) => monthly * 12

// 7 features universal across all tiers. No tier-gated features in v1.
// All shipped or shipping in the same Coach Platform v1 batch. No AI
// suggestion drafts, plateau detection, or churn alerts — those were
// fiction in an earlier draft, removed May 25 2026.
export const COACH_FEATURES = [
  { icon: '📊', label: 'Full cross-domain dashboard',
    sub: 'Strength, cardio, bodyweight, calories, heart rate, sleep, hydration — every metric every client logs, in one view.' },
  { icon: '🎯', label: 'Built-in coaching prescriptions',
    sub: 'Every client gets science-backed next-set weights, pace zones, watts targets, and macro splits — auto-generated from their own numbers.' },
  { icon: '🍴', label: 'Macro plan engine',
    sub: 'Set each client\'s goal weight and pace; the system computes calories and macros. They log meals in-app, you see compliance live.' },
  { icon: '💬', label: '1-on-1 chat with every client',
    sub: 'Real-time messaging with each client, controlled by you (turn on or off per client).' },
  { icon: '🏋️', label: 'Your personal MyRX athlete account',
    sub: 'Use the full client app for your own training — same one your clients use. No extra fee.' },
  { icon: '🚀', label: 'Free updates forever',
    sub: 'Every new page, integration, and feature ships to you the day it lands.' },
]
