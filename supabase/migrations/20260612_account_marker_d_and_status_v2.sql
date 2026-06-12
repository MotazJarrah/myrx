-- T237: marker 'D' (staff/admin — permanent) + richer check_account_status.
--
-- 1. Widen the marker CHECK to include 'D' and backfill superusers.
-- 2. protect_admin_marker trigger: an admin's marker can never be changed
--    away from 'D' by ANY writer, and any superuser row is auto-stamped 'D'
--    on insert/update. Verified by attack-test: a direct
--    `update ... set account_marker='A' where is_superuser` is forced back.
-- 3. check_account_status now also returns:
--      email_confirmed  — false = the account never finished email
--                         verification (password sign-in is impossible;
--                         the coach signup email step OTP-verifies in place
--                         instead of pointing at a login they can't pass)
--      pending_deletion — account is inside the 30-day deletion grace
--                         window (email step: "sign in to reactivate first")

alter table public.profiles drop constraint if exists profiles_account_marker_check;
alter table public.profiles
  add constraint profiles_account_marker_check
  check (account_marker in ('A','AC','C','D'));

update public.profiles set account_marker = 'D' where is_superuser = true;

create or replace function public.protect_admin_marker()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.account_marker = 'D'
     and new.account_marker is distinct from 'D' then
    new.account_marker := 'D';
  end if;
  if new.is_superuser is true then
    new.account_marker := 'D';
  end if;
  return new;
end
$$;

drop trigger if exists trg_protect_admin_marker on public.profiles;
create trigger trg_protect_admin_marker
  before insert or update on public.profiles
  for each row execute function public.protect_admin_marker();

create or replace function public.check_account_status(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_confirmed boolean;
  v_marker    text;
  v_pending   boolean;
begin
  select id, (email_confirmed_at is not null)
    into v_uid, v_confirmed
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_uid is null then
    return jsonb_build_object('exists', false);
  end if;

  select account_marker, (scheduled_for_deletion_at is not null)
    into v_marker, v_pending
  from public.profiles
  where id = v_uid;

  return jsonb_build_object(
    'exists', true,
    'marker', coalesce(v_marker, 'A'),
    'email_confirmed', coalesce(v_confirmed, false),
    'pending_deletion', coalesce(v_pending, false)
  );
end
$$;

grant execute on function public.check_account_status(text) to anon, authenticated;
