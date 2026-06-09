-- T151: grams are the single source of truth for macro plans.
--
-- The web Macro Plan editor authors explicit macros_p_g / macros_f_g /
-- macros_c_g and no longer writes the legacy integer protein_level /
-- fat_level. The mobile wizard now ALSO persists explicit grams (derived at
-- save time) plus its chosen macro_preset. Every read surface (web + phone
-- calories screen, via calcFullPlan) prefers the stored grams and only falls
-- back to the level-derived split for legacy rows that predate grams.
--
-- Because the editor's INSERT payload omits protein_level / fat_level, and
-- both columns were integer NOT NULL with no default, creating a BRAND-NEW
-- client's first plan threw:
--   null value in column "protein_level" of relation "calorie_plans"
--   violates not-null constraint
-- (Existing plans took the UPDATE path and kept their legacy level values, so
-- the bug only surfaced on first-ever plan creation — which is why it looked
-- coach-specific.) Relaxing NOT NULL on the now-optional level columns fixes
-- the INSERT path; the columns remain as a legacy fallback for old rows.
--
-- Applied 2026-06-09 via the Supabase MCP (recorded remotely); this file is
-- the repo record. Idempotent.

alter table public.calorie_plans alter column protein_level drop not null;
alter table public.calorie_plans alter column fat_level   drop not null;
