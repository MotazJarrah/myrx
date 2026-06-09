-- T151 (clean removal) — grams are the single source of truth; remove the dead
-- protein_level / fat_level "level" columns entirely instead of leaving them as
-- vestigial nullable fallbacks.
--
-- Prereqs already shipped before this migration:
--   • web + mobile calcFullPlan read stored macros_p_g/f_g/c_g verbatim, and
--     fall back to a macro_preset-derived level pair (PRESET_LEVELS) — NOT to
--     these columns — when grams are absent.
--   • the mobile PlanWizard no longer writes protein_level/fat_level (it writes
--     grams + macro_preset); its preset re-highlight reads macro_preset.
--   • the calories card derives its macro chip from macro_preset.
--
-- Applied 2026-06-09 via the Supabase MCP (recorded remotely); this file is the
-- repo record. Order matters — widen the preset check, backfill, then drop.

-- 1) macro_preset is now written by BOTH surfaces. Web offers
--    {balanced, high_protein, high_carb, keto}; mobile offers
--    {balanced, high_protein, keto, performance}. Widen the CHECK to the union
--    so neither surface violates it (the old set lacked 'performance').
alter table public.calorie_plans drop constraint if exists calorie_plans_macro_preset_check;
alter table public.calorie_plans add constraint calorie_plans_macro_preset_check
  check (macro_preset is null or macro_preset = any (array['balanced','high_protein','high_carb','keto','performance']::text[]));

-- 2) Backfill explicit grams + a reverse-mapped macro_preset onto the legacy
--    rows that only had levels, using the EXACT runtime formula (Mifflin-St Jeor
--    BMR → TDEE × activity → energy-balance target → protein g/kg × goal, fat %,
--    carbs residual; floor(x+0.5) == JS Math.round). After this, no row depends
--    on the level columns. (No-op now; documented for reproducibility.)
with src as (
  select cp.id, cp.protein_level, cp.fat_level, cp.carb_cap_g, cp.goal_weight_kg,
         cp.energy_balance_pct, cp.activity_factor,
         (case when p.weight_unit='lb' then p.current_weight*0.453592 else p.current_weight end)::numeric as weight_kg,
         (case when p.height_unit='metric' then p.current_height else p.current_height*2.54 end)::numeric as height_cm,
         floor(extract(epoch from (now() - p.birthdate::timestamp)) / (365.25*86400))::numeric as age,
         p.gender
  from calorie_plans cp join profiles p on p.id=cp.user_id
  where (cp.macros_p_g is null or cp.macros_f_g is null or cp.macros_c_g is null)
), c1 as (
  select s.*, (s.weight_kg*9.99 + s.height_cm*6.25 - s.age*4.92 + case when s.gender='male' then 5 else -161 end) as bmr,
    (case s.activity_factor when 1 then 1.2 when 2 then 1.375 when 3 then 1.55 when 4 then 1.725 when 5 then 1.9 end)::numeric as af
  from src s
), c2 as (
  select c.*, (c.bmr*c.af) as tdee, coalesce(c.goal_weight_kg, c.weight_kg) as goal_kg,
    (case c.protein_level when 1 then 1.6 when 2 then 2.0 when 3 then 2.4 end)::numeric as p_gperkg,
    (case c.fat_level when 1 then 0.10 when 2 then 0.20 when 3 then 0.30 when 4 then 0.50 when 5 then 0.70 end)::numeric as f_pct
  from c1 c
), c3 as ( select c.*, floor(c.tdee*c.energy_balance_pct + 0.5) as energy_adj from c2 c
), c4 as ( select c.*, floor(c.tdee + c.energy_adj + 0.5) as daily_target, (c.p_gperkg*c.goal_kg) as protein_g from c3 c
), c5 as (
  select c.*, (c.protein_g*4) as protein_cals,
    case when c.carb_cap_g>0 then c.carb_cap_g*4 else c.daily_target*c.f_pct end as branch_val,
    case when c.carb_cap_g>0 then 1 else 0 end as capped from c4 c
), c6 as (
  select c.*,
    case when capped=1 then greatest(0, daily_target - protein_cals - branch_val) else branch_val end as fat_cals,
    case when capped=1 then branch_val else greatest(0, daily_target - protein_cals - branch_val) end as carb_cals
  from c5 c
)
update calorie_plans cp
set macros_p_g = greatest(0, floor(c6.protein_g + 0.5))::int,
    macros_f_g = greatest(0, floor(c6.fat_cals/9 + 0.5))::int,
    macros_c_g = greatest(0, floor(c6.carb_cals/4 + 0.5))::int,
    macro_preset = case when c6.protein_level=2 and c6.fat_level=3 then 'balanced'
                        when c6.protein_level=3 and c6.fat_level=3 then 'high_protein'
                        when c6.protein_level=1 and c6.fat_level=5 then 'keto'
                        when c6.protein_level=2 and c6.fat_level=2 then 'performance'
                        else null end
from c6 where c6.id = cp.id;

-- 3) Drop the now-unused level columns. Their CHECK constraints
--    (calorie_plans_protein_level_check / _fat_level_check) drop automatically.
alter table public.calorie_plans drop column protein_level;
alter table public.calorie_plans drop column fat_level;
