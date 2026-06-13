# Brand System (Locked)

Purpose: the single standalone reference for MyRX's visual identity (colors, logo, typography), brand voice for system-emitted strings, and the cross-platform brand-sync contract. Locked May 29 2026.

**The canonical brand book is `branding/BRAND.md`** (with paired `BRAND.html` rendering layer and `BRAND.pdf` externally-shareable PDF). Every decision about visual identity, voice, logo usage, color, typography, or brand application traces back to that document. If CLAUDE.md and BRAND.md contradict on a brand topic, BRAND.md wins.

---

## The 4 locked brand colors

| Token | Hex | HSL | Role |
|---|---|---|---|
| **MyRX Lime** | `#CAF240` | `hsl(73°, 87%, 60%)` | Primary accent — CTAs, the "RX" letters, ANY green anywhere in the app |
| **MyRX Dark** | `#121721` | `hsl(220°, 28%, 10%)` | Page background, icon background |
| **MyRX Surface** | `#171C26` | `hsl(220°, 24%, 12%)` | Cards, sheets, drawers — sits 2% lighter than Dark |
| **MyRX Foreground** | `#F4F3EF` | `hsl(60°, 5%, 96%)` | Text + iconography on dark surfaces |

These live in code at:
- **Web** — `web/src/index.css` (both `:root` light mode + `.dark` dark mode CSS variable blocks; every neutral on H=220 hue family)
- **Mobile** — `mobile/src/theme.ts` (the `HSL` object + `palette.myrx.*` hex entries)

## Why the dark is blue-tinted (locked May 29 2026 after green-tinted trial)

Originally locked at green-tinted dark (H=150) so the dark would share a hue family with the lime accent. User feedback during sweep: "too green on green" — the lime and the dark dissolved into each other instead of standing out.

Moved to blue-tinted dark (H=220) because H=220 sits ~147° from the lime (H=73) on the color wheel — close to complementary. The hue separation is what makes the lime POP against the surface instead of blending. Saturation 28% (BG) / 24% (card) was deliberately bumped from the more typical 12–18% range — at lower saturation, the H=220 dark reads as slate-grey instead of recognizable blue. The "blue on lime" pairing IS the brand signature; saturation enforces it.

Past attempts during the iteration (do not re-litigate without explicit user request):
- L=8% (deeper) → reads as grey because less light = less expressed color. Bad.
- S=42% (more saturated at L=10%) → too aggressive, reads navy-corporate. Bad.
- Final: `H=220, S=28%, L=10%` (BG) + `H=220, S=24%, L=12%` (card). User-approved.

## Tagline

**"Performance Lab"** — locked. Appears on the **Tag** logo variant (used for hero placements only — cover pages, marketing hero, presentation title slides). Never on app chrome, never in email signatures, never on social profile avatars. See BRAND.md Section IV "The Slogan Reservation."

## Logo system — 8 variants

Located at `branding/Logo/Final/`:
- `Logo Tag White/Black.{png,svg}` — wordmark + "Performance Lab" tagline (hero placements only)
- `Logo Clean White/Black.{png,svg}` — wordmark only, single-line (most contexts)
- `Logo Block White/Black.{png,svg}` — wordmark in stacked square (tight square spaces)
- `Logo Icon White/Black.{png,svg}` — square with safe-zone padding (favicon, app icon, avatars)

Both PNG + SVG for each. "White" = light text for use on dark BG. "Black" = dark text for use on light BG. The "RX" letters are always lime regardless of variant. **App icon / favicon = `Logo Icon White` (locked)**. Do not crop the Icon variant — its padding is intentional and protected by the safe-zone rule.

## Voice and tone

Locked separately in CLAUDE.md under "Voice and Coaching Philosophy (LOCKED — May 24 2026)" and externally documented in BRAND.md Section III. Never overridden. Every user-facing string runs through the 3-pillar coach voice: **acknowledge state → explain biology → name realistic next step**.

---

## System messages — brand voice rules (LOCKED — May 29 2026)

Every user-facing string the system emits — email subjects, email bodies, SMS, in-app banners, modal copy, toast text, error responses, RPC `RAISE EXCEPTION` strings, humanizer fallbacks — must follow these seven rules. Same rules across mobile + web + edge functions + RPCs. These RULES apply to STRINGS the SYSTEM produces; the existing "Voice and Coaching Philosophy" 3-pillar rule (acknowledge → mechanism → next step) governs COACH-PRESCRIPTION copy (warnings, info pills, plan-evaluation outcomes). Where the two overlap (an error message naming a next step, etc.) both apply at once.

1. **Channel coherence.** Every message reads cleanly on its own surface alone. Email says "tap the button" because there IS a button. In-app banner says "tap Accept" because that's the affordance. SMS says "open the MyRX app" because no inline UI exists. Never reference a button / link / action that doesn't exist where the message renders. **Never reuse email copy verbatim inside the app** (the recurring "tap the link below to install the app" leak — that line makes sense in an email; it's nonsense inside the running app).
2. **No redundancy across blocks.** Subject ≠ H1 ≠ body ≠ personal-message block ≠ secondary block. If the subject is "X invited you to MyRX," the body advances to the next thing rather than restating it. Same principle on every multi-block surface (banner title + body, modal header + subline, page hero + subhero).
3. **The coach leads, doesn't pay.** When subscription coverage comes up, the coach is the leader inviting the athlete to train, not the patron. **Banned phrases:** "your coach's subscription," "fully covered by your coach," "no payment because your coach…," "free under your subscription," "complimentary account," "on your coach." The standalone form **is** fine: `Your MyRX subscription is covered by your coach. No payment is required from you.` Frame the coach as the leader; the billing piece is invisible mechanism happening in the background.
4. **No marketing or performative phrasing.** Banned: "Welcome to your journey," "Ready to transform?", "Let's crush goals," "Start your journey," "Welcome back, Coach," "Welcome to MyRX!", urgency theater, exclamation points on platform copy, "your roster will populate," "Ready to Onboard." Plain factual coach voice always.
5. **No security platitudes / unnamed mechanism gestures.** Banned: "for your security," "we take privacy seriously," "per legal requirement." When restricting or explaining a platform mechanism, name the actual mechanism. Example replacement: "Billing records are retained per legal requirement." → "Billing records stay on file — we're required to keep those for tax + dispute resolution."
6. **Direct address — the athlete is "you."** On athlete-facing surfaces, always second-person. On coach-facing surfaces (when the coach reads ABOUT an athlete on their roster), "the client" is fine. On admin-facing surfaces (admin reading ABOUT a client/coach), "the user" / "the athlete" / "this account" is fine. Never lock these wires: the athlete reading their own banner should never see themselves called "the client."
7. **No filler hedges.** Banned: "consider," "you might want to," "down the line," "feel free to," "please" (when it precedes an imperative — `"Please try again"` → `"Try again."`), "double-check" → "check," "we couldn't" → "Couldn't," `"in the future"`, `"if you'd like"`. Replace with concrete next-step language.

**Plus three formatting conventions that come out of the rules:**

- **Lowercase coach / admin / client** in body copy. Banned: "Coach accounts can't be Clients" → "Coach accounts can't be clients." (Section headers and UI section labels can stay capitalised when they're acting as UI chrome — `YOUR COACH`, `Pending Invites` — but body sentences don't get to capitalise "Coach" as if it were a brand.)
- **Personal message field on coach invite is removed (decision 2b, May 29 2026).** The coach invite ships with a single locked `PRESET_MESSAGE` constant — no per-coach customization. The web `/coach/invite` form shows just the email field + Send Invite button — no preview, no override, the edge function still accepts a `coach_message` body param for back-compat but the web side always passes the preset. Per-coach customization is OFF by design — the audit found that any coach-written variation drifted out of voice within a few sentences, so the field came out.
- **Brand appears in every email subject, but not always first (LOCKED, May 29 2026).** Surveyed pattern across modern apps (Notion, Linear, Vercel, Slack, Figma, GitHub, Stripe) — the dominant convention is **brand mid-sentence + verb-first**, not brand-first. Lead with the action; the brand sits inside the action. Examples currently shipped: `Confirm your MyRX email`, `Sign in to MyRX`, `Reset your MyRX password`, `Confirm your new MyRX email`, `You've been invited to MyRX`. The From field already carries the brand (`MyRX <team@myrxfit.com>`) so the subject doesn't have to. **Coach invite is an industry-norm exception**: `{coachName} invited you to MyRX` — the inviter's name leads, because the personal hook of "someone you know is inviting you" measurably outperforms brand-first in invite open rates (Slack, Notion, Figma, Linear, Asana all do the same). Banned subject patterns: `Welcome to MyRX — X`, `MyRX — X`, `[MyRX] X`, brand-only subjects with no verb.

**When you write ANY new user-facing string** (new banner, new error, new email template, new RPC exception), run it through all 7 rules + the three formatting conventions before shipping. New strings that obviously violate any rule should be fixed before commit, not after a user complaint.

---

## Brand sync rule (cross-platform — MANDATORY)

When updating brand colors or visual tokens:

1. Update `web/src/index.css` light + dark mode blocks together
2. Update `mobile/src/theme.ts` HSL object + `palette.myrx` hex entries together
3. Bump the `--myrx-build` marker in `web/src/index.css` to force CSS hash rotation (cache-poisoning rule — see Browser/React scars section)
4. Update `branding/BRAND.md` if hex values change, then regenerate `BRAND.html` + `BRAND.pdf` (Chrome headless print-to-PDF: `chrome --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="branding/BRAND.pdf" "file:///.../branding/BRAND.html"`)
5. Build + deploy web. Reload mobile.

NEVER let web and mobile drift on brand colors. NEVER introduce a new green shade — every green in the system is `#CAF240`. Semantic emerald (`#10B981`) is for "save succeeded" / "data persisted" only — different semantic from brand lime.

## Components reference

- **Web Tailwind classes** (resolve via the CSS variables above): `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`, `bg-secondary`, `text-secondary-foreground`, `bg-accent`.
- **Mobile imports** from `mobile/src/theme.ts`: `import { colors, palette, alpha, withAlpha } from '@/theme'` — use `colors.background`, `colors.primary`, `palette.myrx.lime`, `palette.myrx.dark`, etc.
- **For HSL → HSLA alpha** (semi-transparent overlays): `alpha(colors.primary, 0.1)` produces `hsla(...)`.
- **For hex → rgba alpha** on palette entries: `withAlpha(palette.myrx.lime, 0.18)` produces `rgba(...)`.

## Button system (LOCKED — Jun 13 2026)

Three lime button styles, one per action INTENT — pick the tier by what the button does, never by looks. Lime = `--primary` (web) / `colors.primary` (mobile).

| Tier | Intent | Web (Tailwind) | Mobile | Use for |
|---|---|---|---|---|
| **Solid lime** | Primary action / CTA | `bg-primary text-primary-foreground hover:bg-primary/90` | bg `colors.primary`, dark text (`colors.primaryForeground` / MyRX Dark) | Save · Continue · Create account · Start free trial · Subscribe — the ONE main action on a screen |
| **Soft lime** | Directional / navigation | `bg-primary/10 text-primary hover:bg-primary/20` + a trailing arrow | bg `alpha(colors.primary, 0.10)`, text `colors.primary` | For Coaches · Manage plan · Learn more · "go to X" — any control that sends you somewhere |
| **Outline lime** | Reverse / cancel / secondary | `border border-primary/40 text-foreground hover:bg-primary/10` | transparent bg, border `alpha(colors.primary, 0.4)`, text `colors.foreground` | Cancel · Back · Use a different email · dismiss · the step-back action |

Rules:
- **One solid per view.** At most one solid-lime CTA per screen (the primary action). Everything else is soft or outline — two solids compete; demote the lesser one to outline.
- **Soft = it navigates.** Directional buttons get the soft tint + a trailing arrow: `ArrowUpRight` for cross-surface/external (e.g. → coach.myrxfit.com), `ArrowRight` for same-surface. The arrow is the "this takes you somewhere" signal.
- **Outline = it walks back.** Cancel / Back / decline / secondary. Never a solid "Cancel" (a filled lime cancel reads as the thing to click).
- **Destructive is NOT in this system.** Delete / Wipe / Sign out keep the red `destructive` treatment — outline-lime is for BENIGN reverses (cancel/back) only, never for destructive actions.
- Applies to EVERY surface — athlete web, coach web, admin portal, mobile. Site/app-wide rollout tracked in T264.

## Past incident — color update gotcha (May 29 2026)

If you update brand colors but only on one side (web OR mobile), the cross-platform-consistency rule is violated. Both surfaces MUST land together in the same turn. See task log #314 / #318 for the May 29 2026 sweep where the original cool-blue-tinted dark `#0D0F11` (HSL 220, 12%, 6%) was migrated via green-tinted dark `#131A17` (HSL 150, 15%, 9%) — rejected by user — and finally landed at the locked blue-tinted dark `#121721` (HSL 220, 28%, 10%) across both codebases simultaneously, along with primary going from HSL(80, 95%, 55%) → HSL(73, 87%, 60%) to match the locked `#CAF240` lime.
