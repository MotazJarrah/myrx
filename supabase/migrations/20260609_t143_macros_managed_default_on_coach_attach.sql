-- T143 Option 1: when a client is ATTACHED to a coach/admin (coach_id goes
-- NULL -> set, or INSERT already-linked), default them to COACH-MANAGED
-- (macros_managed_by_coach = true) so a freshly-linked client is read-only by
-- default and not accidentally editable. When DETACHED (coach_id -> NULL) the
-- client becomes self-coached, so clear the flag (false).
--
-- Fires only on UPDATE OF coach_id (and INSERT). The coach's "Self-managed"
-- handback writes macros_managed_by_coach directly (a different column), so it
-- does NOT trip this trigger — the handback's `false` sticks. A coach swap
-- (coach_id A->B, both non-null) leaves the flag as-is. Sibling of
-- sync_is_self_coached() which derives is_self_coached := (coach_id IS NULL).
--
-- Applied 2026-06-09 via the Supabase MCP (recorded remotely); this file is the
-- repo record. Idempotent: create-or-replace + drop-if-exists.

create or replace function public.sync_macros_default_on_coach_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.coach_id is not null and (TG_OP = 'INSERT' or OLD.coach_id is null) then
    NEW.macros_managed_by_coach := true;   -- newly attached -> coach-managed
  elsif NEW.coach_id is null then
    NEW.macros_managed_by_coach := false;  -- detached -> self-managed
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_macros_default_on_coach_change on public.profiles;
create trigger trg_sync_macros_default_on_coach_change
  before insert or update of coach_id on public.profiles
  for each row execute function sync_macros_default_on_coach_change();
