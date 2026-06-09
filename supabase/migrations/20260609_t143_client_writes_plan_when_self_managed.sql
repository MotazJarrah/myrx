-- T143 Option 1: a client may author/edit their OWN calorie_plans row when
-- they are NOT coach-managed — i.e. macros_managed_by_coach = false. This
-- covers BOTH a truly self-coached athlete (no coach) AND a coached client
-- whose coach has handed the plan back ("Self-managed" chip). It replaces the
-- prior is_self_coached-gated policies, which locked out handed-back clients
-- (a coached client is permanently is_self_coached=false via the coach_id trigger).
-- Coach-managed clients (macros_managed_by_coach = true) still cannot self-write;
-- the coach owns the plan via the existing coach roster policies.
--
-- Applied 2026-06-09 via the Supabase MCP (recorded remotely); this file is the
-- repo record. Idempotent: drop-if-exists then recreate.

drop policy if exists "Users insert own plan when self-coached" on public.calorie_plans;
drop policy if exists "Users update own plan when self-coached" on public.calorie_plans;
drop policy if exists "Users insert own plan when self-managed" on public.calorie_plans;
drop policy if exists "Users update own plan when self-managed" on public.calorie_plans;

create policy "Users insert own plan when self-managed"
  on public.calorie_plans
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.macros_managed_by_coach = false
    )
  );

create policy "Users update own plan when self-managed"
  on public.calorie_plans
  for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.macros_managed_by_coach = false
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.macros_managed_by_coach = false
    )
  );
