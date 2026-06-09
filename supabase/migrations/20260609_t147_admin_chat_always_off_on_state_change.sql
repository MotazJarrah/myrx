-- T147: admin_chat_enabled is ALWAYS off unless the admin explicitly turns it
-- on per client. Force it off on INSERT and on ANY coach_id change
-- (link / unlink / switch from any state to any state). The admin's manual
-- toggle updates ONLY admin_chat_enabled (not coach_id), so it does NOT trip
-- this trigger -- the explicit `true` sticks until the next state change.
--
-- Extends the existing coach-change trigger (which already sets the
-- macros-managed default on attach/detach). Same trigger event.
--
-- Applied 2026-06-09 via the Supabase MCP (recorded remotely); this file is the
-- repo record. Idempotent.

create or replace function public.sync_macros_default_on_coach_change()
returns trigger
language plpgsql
as $$
begin
  -- T143: macros-managed default — coach-managed on attach, self on detach.
  if NEW.coach_id is not null and (TG_OP = 'INSERT' or OLD.coach_id is null) then
    NEW.macros_managed_by_coach := true;
  elsif NEW.coach_id is null then
    NEW.macros_managed_by_coach := false;
  end if;

  -- T147: admin chat is ALWAYS off on insert AND on any coach_id change
  -- (link / unlink / switch). Only the admin's explicit per-client toggle
  -- (an admin_chat_enabled-only UPDATE) turns it back on.
  if TG_OP = 'INSERT' or NEW.coach_id is distinct from OLD.coach_id then
    NEW.admin_chat_enabled := false;
  end if;

  return NEW;
end;
$$;

-- Enforce the column default = false (belt-and-suspenders).
alter table public.profiles alter column admin_chat_enabled set default false;

-- One-time clean slate: everything off. The admin turns chat on per client.
update public.profiles set admin_chat_enabled = false where admin_chat_enabled is distinct from false;
