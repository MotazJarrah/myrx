-- Keep the "goal reached" celebration consistent with how a plan save works.
--
-- Background: goal_reached is a STICKY flag. It's set true by the weigh-in trigger
-- check_goal_reached_on_weighin (handles BOTH loss and gain directions) and must
-- survive weight fluctuations once true. The bug: the admin "Update plan" save (and
-- the end-user web editor / mobile wizard) re-baseline the phase — starting_weight_kg
-- is auto-synced to the client's current weight on every save — but never cleared
-- goal_reached. That left a reached client's progress bar stuck at 100% even after the
-- coach re-baselined the phase to "current -> goal".
--
-- Fix: clear goal_reached whenever the phase is re-baselined, i.e. the starting weight
-- OR the goal weight changes. This makes a reached client behave like a not-yet-reached
-- one after a save (fresh progress toward the goal), enforced at the DB layer so every
-- writer (admin web, end-user web, mobile) is covered in one place.
--
-- It fires ONLY on a start/goal change, so:
--   * weight fluctuations alone never clear it (weigh-ins don't touch calorie_plans), and
--   * check_goal_reached_on_weighin (sets only goal_reached, never start/goal) is never
--     undone — a genuinely reached goal stays 100% until the coach saves or edits it.
--
-- NOTE: one production row left stale by the pre-trigger bug was repaired out-of-band.
-- No blanket data-fix is included here on purpose: a current-weight-vs-goal sweep would
-- wrongly demote a legitimately-reached-and-maintaining client (goal_reached is sticky
-- by design). From this trigger forward no new stale rows can form.

create or replace function public.reset_goal_reached_on_phase_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.goal_weight_kg     is distinct from old.goal_weight_kg
     or new.starting_weight_kg is distinct from old.starting_weight_kg then
    new.goal_reached := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_goal_reached on public.calorie_plans;
create trigger trg_reset_goal_reached
  before update on public.calorie_plans
  for each row
  execute function public.reset_goal_reached_on_phase_change();
