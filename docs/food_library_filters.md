# food_library — Filter Design Spec

The growing spec of filter rules we want to apply to the `food_library` table, based on observations in `food_library_audit.md`.

This document starts empty and is built up incrementally as the audit reveals patterns worth filtering. Each rule has a reasoning trail back to the audit observation that motivated it — so anyone reading later understands why the rule exists.

When this document settles (all proposed rules either approved or rejected), it gets converted into:
1. A **cleanup migration** that removes existing rows matching the filter rules.
2. **Sync-time filters** in `scripts/d1_migrate/sync_usda.mjs` and `sync_on.mjs` so future imports never let those rows in.

Rules are NOT applied during the bulk import (that goes through everything raw — see `scripts/bulk_import/run.mjs`).

---

## Filter rule template

Each proposed rule looks like:

```
### Rule N — short name
**Status:** proposed | approved | rejected | deferred
**Source:** which sources / subtypes does this apply to (usda branded? all? specific subtype?)
**Condition:** the SQL predicate that identifies rows to remove
**Why:** plain-English reasoning, with link to audit observation
**Estimated impact:** approx number of rows this removes
**Decided:** YYYY-MM-DD by <user|claude>
```

---

## Proposed rules

*(Empty for now. Will grow as the audit progresses.)*

---

## Evaluation hierarchy (which order rules run in)

Rules are evaluated in tiers. The first matching rejection wins; later checks are skipped for that row. Repair (Tier 1) runs BEFORE rejection so rows get their best chance.

### Tier 1 — REPAIR
| Rule | What it does |
|---|---|
| 9 | Backfill missing kcal from macros (4p + 9f + 4c) |

### Tier 2 — REJECT structurally broken
| Rule | Rejects |
|---|---|
| 5 | Wrong-category subtypes (sub_sample_food, agricultural_acquisition) |
| 1 | All four primary macros null or zero (after Rule 9 attempt) |
| 6 | kcal > 900 per 100g (impossible density) |
| 10 | Macro sum > 105g per 100g (impossible mass) |
| 11 | Any single macro > 100g per 100g (impossible mass) |

### Tier 3 — REJECT internally inconsistent
| Rule | Rejects |
|---|---|
| 4 | kcal vs (4p + 9f + 4c) differ by > 50% (with safety floor pred ≥ 20) |
| 7 | Per-serving kcal > 3,000 |

### Tier 4 — REJECT negligible
| Rule | Rejects |
|---|---|
| 8 | Branded entries with per-serving < 5 kcal |

### Tier 5 — DEDUP (post-import, cross-row)
| Rule | Method |
|---|---|
| 2 | Exact dedup on name + brand + macros + serving_label + upc → keep MAX(id) |
| 3 | Brand-product dedup on name + brand + macros + serving_g → highest source_id |

Implementation: `scripts/d1_migrate/lib/filters.mjs` — `enrichFood()` is Rule 9, `shouldKeepFood()` covers Tiers 2-4 in the order above. Dedup (Tier 5) lives in `scripts/bulk_import/post_import_dedup.mjs`.

---

## Approved rules (becomes the cleanup migration)

### Rule 11 — Any single macro > 100g per 100g
**Status:** approved + applied 2026-05-14
**Source:** all
**Condition:** `protein_g > 100 OR fat_g > 100 OR carbs_g > 100`
**Why:** Physically impossible. You can't have, e.g., 125g of protein in 100g of food. Examples caught: "APPLE MELON ZERO CARB PROTEIN DRINK" with 125g protein, "MEDIUM BRAZIL NUTS" with 93g protein but a total macro mass of 173g.
**Actual impact:** 149 additional rows deleted (most rows with a single macro > 100 also had sum > 105 and were already caught by Rule 10).
**Decided:** 2026-05-14 by user

### Rule 10 — Macro sum > 105g per 100g (physically impossible mass)
**Status:** approved + applied 2026-05-14
**Source:** all
**Condition:** `(COALESCE(protein_g,0) + COALESCE(fat_g,0) + COALESCE(carbs_g,0)) > 105`
**Why:** A food can't contain more macro mass than its own total mass. Sum > 100 g per 100 g of food is impossible. Threshold 105 (vs 100) allows rounding artifacts — pure-sugar candy can legitimately sum to 100-104g when each macro is rounded independently. Rows above 105g are definitive errors (e.g. "Mountain Man Brazil Nuts" at sum=173g, "Korean Seaweed Snacks" at sum=160g, "Apple Melon Protein Drink" at sum=125g — clearly data-entry errors, possibly unit confusion like percentages-vs-grams).
**Why not 100:** Sample inspection of the 100-105g band (5,301 rows) showed every entry was a real food (Sugar Cookies, Lollipops, Potato Chips, Cereal, Tortilla Chips, etc.) where rounded macros sum slightly over 100. Deleting them would be a false positive.
**Where Rule 4 misses these:** Rule 4 (kcal mismatch) caught cases where kcal disagrees with macros. But a row like "111g carbs, 0 protein, 0 fat, kcal=556" has predicted=444 and recorded=556 → 25% mismatch, below Rule 4's 50% threshold. The 111g carb value is physically impossible but Rule 4 didn't flag it. Rule 10 is the catch.
**Actual impact:** 4,720 rows deleted.
**Decided:** 2026-05-14 by user

### Rule 9 — Backfill missing kcal from macros
**Status:** approved + applied 2026-05-14
**Source:** all (REPAIR, not REJECT)
**Action:** `kcal = ROUND(protein_g*4 + fat_g*9 + carbs_g*4, 1)` when `kcal IS NULL` AND at least one macro is non-null AND the computed sum > 0.
**Why:** Many rows (including USDA Foundation Foods like "Chicken, breast, boneless, skinless, raw") have NULL kcal but populated macros. They display as "0 cal" in the table UI even though the macros are real. Computing kcal from the 4/9/4 formula recovers them. Rule 4 (kcal vs macros mismatch) won't false-flag these because they match by construction.
**Risk:** If macros themselves are wrong, the computed kcal will be wrong too — and Rule 4 won't catch it. Mitigations: Rules 6, 10, 11 still apply to backfilled rows and catch impossible computed values. Real-world risk: low (USDA branded data comes from FDA labels; Foundation/SR Legacy is lab-tested).
**Actual impact:** 19,364 rows had kcal backfilled.
**Decided:** 2026-05-14 by user

### Rule 8 — Branded entries with negligible per-serving kcal
**Status:** approved + applied 2026-05-14
**Source:** branded only (`branded_food`, `on_branded`)
**Condition:** `kcal IS NOT NULL AND serving_g IS NOT NULL AND (kcal * serving_g / 100.0) < 5 AND source_subtype IN ('branded_food', 'on_branded')`
**Why:** A branded product at < 5 calories per serving is almost always one of: sugar-free gum, sweeteners, salt-free seasonings, diet sodas, zero-cal flavored waters, or a data error like a 0.5g cottage cheese serving. None of these contribute meaningfully to calorie tracking; they only add search noise.
**Why branded only:** Canonical reference subtypes (foundation_food, sr_legacy_food, survey_fndds_food) include legitimate low-cal entries with real natural servings — yellow mustard (1 tsp = 3.7 cal), 1 stuffed olive (4.2 cal), 1 dill pickle spear (4.9 cal), fresh basil (2.5g), babyfood — that ARE real foods users might log. Sample inspection of the 143 SR Legacy + 3 Foundation rows that would have been deleted confirmed they're legitimate reference data.
**Actual impact:** 9,015 rows deleted (~0.9% of pre-rule DB):
  - `branded_food`: -7,301
  - `on_branded`: -1,714
**Decided:** 2026-05-14 by user

### Rule 6 — Impossible kcal density (>900 per 100g)
**Status:** approved + applied 2026-05-14
**Source:** all (`usda`, `on`, `myrx`)
**Condition:** `kcal > 900`
**Why:** Pure fat — the most calorie-dense edible substance — is ~884 kcal per 100g. Any food labeled higher than 900 kcal/100g is physically impossible; the value is almost certainly a per-serving or per-container value mistakenly entered in the per-100g slot. Sample inspection of `kcal/100g` values 3,000+ confirmed this — entries like "NUTRAMENT COMPLETE NUTRITION DRINK" listed at 3,000 kcal/100g (real value: ~100), "Cronut" at 3,070 (real: ~440), nutrition shakes at 5,312 (real: ~150).
**Actual impact:** 2,810 rows deleted.
**Decided:** 2026-05-14 by user

### Rule 7 — Per-serving kcal ceiling (>3000)
**Status:** approved + applied 2026-05-14 (via clean rebuild)
**Source:** all
**Condition:** `kcal IS NOT NULL AND serving_g IS NOT NULL AND (kcal * serving_g / 100.0) > 3000`
**Why:** A single serving of a single food product realistically tops out below 2,500-3,000 kcal — that's already larger than a full restaurant entrée. Above 3,000 kcal/serving the row almost certainly has an inflated `serving_g` (whole-package weight entered as a single serving) rather than a real per-serving value. Sample inspection confirmed >95% of rows in the 3,000+ band were data errors.
**Initial blocker:** DB was at 501 MB cap when this rule was first attempted as a DELETE; transactions blocked. Resolved by including it in the clean-rebuild filter library so it runs at INSERT time alongside Rules 1, 4, 5, 6.
**Actual impact:** 37 rows filtered during the clean rebuild (29 from USDA + 8 from OpenNutrition). Most rows that previously matched this rule were also caught by Rule 6 (density >900) — the 37 here are the cases where density is plausible but the serving_g is inflated.
**Decided:** 2026-05-14 by user

---

## Clean rebuild completed — 2026-05-14

All 7 rules above were applied via `scripts/bulk_import/clean_rebuild.mjs` (single end-to-end script that drops + recreates the tables, runs the bulk import with Rules 1, 4, 5, 6, 7 applied at INSERT time, restores myrx, then runs Rules 2 + 3 as post-import dedup DELETEs).

**Result:** DB went from 501 MB / 1.03M rows → 384 MB / 1.03M rows. Filter logic now lives in `scripts/d1_migrate/lib/filters.mjs` and is reused by ongoing sync scripts so future imports stay clean.

**Rule application order (final):**
- During INSERT (loaders apply these): Rules 1, 4, 5, 6, 7
- Post-import DELETE passes: Rules 2, 3

### Rule 5 — Drop research-artifact USDA subtypes
**Status:** approved + applied 2026-05-14
**Source:** USDA only
**Condition:** `source_subtype IN ('sub_sample_food', 'agricultural_acquisition')`
**Why:** Both subtypes are research-internal data, NOT consumer-facing food records:
  - `sub_sample_food` (3,018 rows): Individual sub-samples USDA scientists analyzed as part of building Foundation Food entries. Typically only one nutrient populated (just `fat_g`, or just protein). Names like "Proximates, Tuna canned BUMBLEBEE CHUNK LIGHT" or "FLOUR ALL PURPOSE" — research labels, not loggable foods.
  - `agricultural_acquisition` (805 rows): Lab samples acquired from agricultural sources for analysis. Names contain sample IDs and lab conditions: "Beans, Dry, Pinto, 740 (0% moisture)". Mostly only protein + fat populated.

  Both are inputs to USDA's research pipeline that aim to BUILD Foundation Foods over time, not finished food entries. Surfacing them in a user-facing food search creates noise and confusion. They survived Rule 1 only because some had a single non-null macro; Rule 4 didn't touch them because most lack kcal entirely.
**Actual impact:** 3,823 rows deleted (entire subtype eliminations).
**Decided:** 2026-05-14 by user

### Rule 4 — kcal mismatch vs predicted (>50% off)
**Status:** approved + applied 2026-05-14
**Source:** all (`usda`, `on`, `myrx`)
**Condition:**
```sql
ABS(kcal - (protein_g*4 + fat_g*9 + carbs_g*4)) / (protein_g*4 + fat_g*9 + carbs_g*4) > 0.50
  AND (protein_g*4 + fat_g*9 + carbs_g*4) >= 20   -- safety floor for low-cal items
  AND kcal IS NOT NULL AND protein_g IS NOT NULL AND fat_g IS NOT NULL AND carbs_g IS NOT NULL
```
**Why:** Standard nutrition math: predicted kcal = protein×4 + fat×9 + carbs×4. Rows whose recorded kcal differs from this prediction by >50% are almost always data errors — typical patterns observed in the sample:
  - "0 calorie sweetener / seasoning" items with macros > 0 (Stevia, Adobo, Garlic Salt, etc.) — the "0 cal" marketing claim contradicts the reported per-100g macros
  - Coffee creamers / non-dairy creamers showing 500 kcal but macros predicting ~200 (fat underreported by ~3×)
  - Sauces, snacks, gels with grossly underreported fat
**Safety floor (`pred >= 20`):** very-low-cal items (broths, herbs, vinegars) have unstable proportional math — a 2 vs 4 kcal gap is 100% off but meaningless. Floor avoids deleting legitimate near-zero-cal foods.
**Why 50% and not lower:** the 25-50% off band contains many LEGITIMATE products that just don't follow the 4/9/4 formula — sugar-free gums (polyols are 0 cal but count as carbs in math), high-fiber tortillas (fiber is ~2 cal/g not 4), "0g total sugar" chocolates with erythritol, low-fat ice cream with sugar alcohols. Inspected ~12 random rows in that band → ~40% were legit, not errors. The 50%+ band is much cleaner (~95%+ real errors per sample).
**Actual impact:** 10,964 rows deleted (~1% of pre-rule DB).
**Breakdown:**
  - `branded_food`: -7,922
  - `on_branded`: -2,848
  - `on_generic`: -112
  - `survey_fndds_food`: -58
  - `sr_legacy_food`: -24
**Decided:** 2026-05-14 by user

### Rule 3 — Brand-product dedup (name + brand + macros + serving_g)
**Status:** approved + applied 2026-05-14
**Source:** all (`usda`, `on`, `myrx`)
**Match key:**
  - `LOWER(TRIM(name))`
  - `LOWER(TRIM(brand))`
  - `kcal`, `protein_g`, `fat_g`, `carbs_g`
  - `serving_g` (NULL=NULL via COALESCE)
**Required (non-NULL):** `brand`, `name`, `kcal`, `protein_g`, `fat_g`, `carbs_g`
**Tiebreak (winner per group):** highest `source_id` — `CAST(source_id AS INTEGER) DESC` first, then `source_id DESC` for non-numeric ties.
**SQL:**
```sql
DELETE FROM food_library
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(brand)),
                   kcal, protein_g, fat_g, carbs_g,
                   COALESCE(serving_g, -1.0)
      ORDER BY CAST(source_id AS INTEGER) DESC, source_id DESC
    ) AS rn
    FROM food_library
    WHERE brand IS NOT NULL AND name IS NOT NULL
      AND kcal IS NOT NULL AND protein_g IS NOT NULL
      AND fat_g IS NOT NULL AND carbs_g IS NOT NULL
  ) ranked WHERE rn > 1
);
```
**Why:** Catches additional duplicates beyond Rule 2 — same product re-submitted to USDA under different package SKUs (different UPCs) or with minor serving_label phrasing differences (`"1/2 cup"` vs `"0.5 cup"` vs `"112 g"` vs `"4 oz"`). Sample showed all clean duplicates (same product, different package codes). The `brand IS NOT NULL` filter prevents generic-food false-merges (Foundation Foods etc.); the `all macros NOT NULL` filter prevents null-collapse false-merges (where `fat_g = 0.07` alone groups Oranges with Pears).
**Actual impact:** 88,181 rows deleted (~7.8% of pre-rule DB).
**Breakdown:**
  - `branded_food`: -61,230
  - `on_branded`: -26,951
**Decided:** 2026-05-14 by user

### Rule 2 — Cross-source dedup (name + brand + macros + serving_label + UPC)
**Status:** approved + applied 2026-05-14
**Source:** all (`usda`, `on`, `myrx`)
**Match key (NULL=NULL, text fields case-folded + trimmed):**
  - `LOWER(TRIM(name))`
  - `LOWER(TRIM(brand))`
  - `kcal`
  - `protein_g`
  - `fat_g`
  - `carbs_g`
  - `LOWER(TRIM(serving_label))`
  - `upc`
**Tiebreak (which row in the dup group survives):** `MAX(id)` — newest insertion wins.
**SQL:**
```sql
DELETE FROM food_library
WHERE id NOT IN (
  SELECT MAX(id) FROM food_library
  GROUP BY COALESCE(LOWER(TRIM(name)),''), COALESCE(LOWER(TRIM(brand)),''),
           COALESCE(kcal,-1.0), COALESCE(protein_g,-1.0), COALESCE(fat_g,-1.0),
           COALESCE(carbs_g,-1.0), COALESCE(LOWER(TRIM(serving_label)),''),
           COALESCE(upc,'')
);
```
**Why:** USDA's branded dataset accumulates the same product as multiple `fdc_id` submissions over years (different distributors, same product). OpenNutrition also has cross-source overlap with USDA. When name + brand + UPC + all four macros + serving label all match exactly, we're confident the rows describe the same physical food. Keeping the newest insertion gives us the most recently re-validated nutrition data.
**Actual impact:** 1,018,844 rows deleted (47% of pre-dedup DB).
**Breakdown of where it hit:**
  - `branded_food`: -1,018,287 (most of the duplicates were here)
  - `sub_sample_food`: -445
  - `foundation_food`: -55
  - `on_branded`: -46
  - `agricultural_acquisition`: -5
  - `on_generic`: -5
  - `survey_fndds_food`: -1
**Decided:** 2026-05-14 by user

### Rule 1 — No macros, no entry
**Status:** approved + applied 2026-05-14
**Source:** all (`usda`, `on`, `myrx`)
**Condition:** `(kcal IS NULL OR kcal = 0) AND (protein_g IS NULL OR protein_g = 0) AND (fat_g IS NULL OR fat_g = 0) AND (carbs_g IS NULL OR carbs_g = 0)`
**Why:** A row where all four primary macros (calories, protein, fat, carbs) are either missing OR explicitly zero is unusable for the only thing this DB exists to support — logging food and tracking macros. This catches both data errors (e.g. "MAPLE WALNUT SYRUP" listed at 0 kcal) AND legitimately zero-macro items (water, salt, pepper, baking soda) since neither is loggable for calorie tracking. Sodium is not factored in — salt/water belong in a hydration tracker if we ever build one, not in the food log.
**Estimated → Actual impact:** 277,145 rows deleted total (~11.4% of pre-cleanup DB)
  - **v1 (all NULL):** 190,787 rows
  - **v2 expansion (0 also counts as missing):** +86,358 rows
**Breakdown of where it hit (cumulative):**
  - `branded_food`: -181,591 (~9% of branded)
  - `sub_sample_food`: -71,584 (95% of sub_sample was junk)
  - `on_branded`: -12,068
  - `market_acquistion` (USDA's typo): -7,577 (entire category)
  - `sample_food`: -4,079 (entire category)
  - `experimental_food`: -114 (entire category)
  - `on_generic`: -50
  - `foundation_food`: -43
  - `sr_legacy_food`: -26
  - `survey_fndds_food`: -13
**Decided:** 2026-05-14 by user

---

## Rejected proposals

*(Track rules we considered but decided NOT to apply, with reasoning. So we don't keep re-suggesting the same idea.)*
