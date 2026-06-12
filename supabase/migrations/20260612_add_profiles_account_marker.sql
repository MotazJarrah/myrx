-- T234: account_marker = the source-of-truth signup/role marker on profiles.
--   A  = athlete (signed up on mobile; no web surface)
--   AC = athlete switching to coach (mid-conversion; reversible)
--   C  = coach (web coach signup new email, or a completed conversion)
--
-- The marker is what host-aware routing (web/src/lib/roleRouting.js) reads to
-- decide where a signed-in user belongs, and what each platform uses to gate
-- which signup journey it interprets (so the shared signup_checkpoint column
-- never cross-contaminates between the athlete and coach journeys).

alter table public.profiles
  add column if not exists account_marker text not null default 'A';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_account_marker_check'
  ) then
    alter table public.profiles
      add constraint profiles_account_marker_check
      check (account_marker in ('A','AC','C'));
  end if;
end $$;

-- Backfill: completed or in-progress coaches -> C; everyone else stays 'A'.
update public.profiles
set account_marker = 'C'
where account_marker <> 'C'
  and (is_coach = true
       or coach_subscription_status is not null
       or coach_stripe_customer_id is not null);

-- Mid-coach-signup accounts (started the coach signup on web via the
-- signup_journey='coach' auth metadata, not yet a coach) -> C.
update public.profiles p
set account_marker = 'C'
from auth.users u
where u.id = p.id
  and p.account_marker = 'A'
  and (u.raw_user_meta_data ->> 'signup_journey') = 'coach';
