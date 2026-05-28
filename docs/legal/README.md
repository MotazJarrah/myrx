# MyRX Legal Documents — Archive

Word-readable snapshots of every legal document published on myrxfit.com,
kept here for offline reference + lawyer review.

**Source of truth lives elsewhere.** The .docx files in this folder are
*generated* from the live React components at `web/src/pages/legal/*.jsx`.
**Never edit the .docx files directly** — your changes get clobbered on the
next regeneration. To change a legal document:

1. Edit the corresponding `.jsx` file in `web/src/pages/legal/`
2. Run `python scripts/build_legal_docx.py` from the repo root
3. Deploy the web change normally (`cd web && npm run build && npx wrangler pages deploy dist --project-name myrx --commit-dirty=true`)

The regenerator overwrites all 9 .docx files in this folder.

## Index

| Document | File | Live URL | Audience | Last touched |
|---|---|---|---|---|
| Terms of Service | `TermsOfService.docx` | https://myrxfit.com/terms | Everyone (end-users, coaches, athletes) | May 2026 (Phase 3 consent audit) |
| Privacy Policy | `PrivacyPolicy.docx` | https://myrxfit.com/privacy | Everyone | May 2026 |
| Acceptable Use Policy | `AcceptableUsePolicy.docx` | https://myrxfit.com/acceptable-use | Everyone | May 2026 |
| Cookie Policy | `CookiePolicy.docx` | https://myrxfit.com/cookies | Everyone (referenced by CookieBanner) | May 2026 |
| Health & Medical Disclaimer | `HealthDisclaimer.docx` | https://myrxfit.com/health-disclaimer | Everyone | May 2026 (Phase 3 pre-work, task #168) |
| Coach Agreement | `CoachAgreement.docx` | https://myrxfit.com/coach-agreement | Coaches signing up (required checkbox at signup) | May 2026 (task #166) |
| Refund Policy | `RefundPolicy.docx` | https://myrxfit.com/refund-policy | Coaches + B2C buyers | May 2026 (task #167) |
| Data Processing Agreement | `DataProcessingAgreement.docx` | https://myrxfit.com/dpa | Coaches (GDPR controller/processor relationship) | May 2026 (task #169) |
| How We Compute | `HowWeCompute.docx` | https://myrxfit.com/how-we-compute | Anyone curious about our formulas (BMR, TDEE, projections) | May 2026 |

## Notes for review

- All docs are wrapped by `LegalLayout` (`web/src/pages/legal/LegalLayout.jsx`) which provides the consistent header/footer/print styling on the live site.
- **Coach Agreement** is the only one with a mandatory checkbox during signup (task #171). Coaches can't create an account without explicitly agreeing.
- **DPA** is required for any coach in the EU/UK under GDPR Article 28 (controller/processor relationship between MyRX and the coach).
- **Health & Medical Disclaimer** covers liability for self-coached weight-loss recommendations and clarifies MyRX is not a healthcare provider.
- **How We Compute** is the user-facing version of the formula attribution registry locked in CLAUDE.md (Mifflin-St Jeor, Katch-McArdle, Daniels-Gilbert VDOT, etc.).
- The CookieBanner respects `CookiePolicy` and uses three categories: necessary / analytics / marketing.

## DOCX formatting

The converter (`scripts/build_legal_docx.py`) maps JSX to Word styles:

| JSX | Word |
|---|---|
| `<LegalLayout title=X effectiveDate=Y>` | Title (level 0) + italic slate-grey effective date |
| `<h1>` / `<h2>` / `<h3>` | Heading 1 / 2 / 3 |
| `<p>` | Normal paragraph |
| `<ul><li>` | List Bullet |
| `<ol><li>` | List Number |
| `<strong>` / `<b>` | Bold |
| `<em>` / `<i>` | Italic |
| `<a href="…">label</a>` | Real Word hyperlink (blue, underlined, clickable) |

`{' '}` JSX whitespace tokens become normal spaces. Other JSX expressions
(`{var}` etc.) are stripped — these docs are 100% static prose by design.
