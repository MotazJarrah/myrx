-- Publish calorie_plans + bodyweight to Supabase realtime so the mobile Calories
-- page live-refreshes when a coach edits the plan/goal (calorie_plans) or when a
-- weigh-in lands (bodyweight). Previously neither table was in the publication,
-- so a coach's "Update plan" change didn't reach the client until a full remount.
-- REPLICA IDENTITY FULL so the user_id filter + UPDATE/DELETE payloads resolve
-- reliably (mirrors 20260529b/c).

alter table public.calorie_plans replica identity full;
alter table public.bodyweight   replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calorie_plans'
  ) then
    alter publication supabase_realtime add table public.calorie_plans;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bodyweight'
  ) then
    alter publication supabase_realtime add table public.bodyweight;
  end if;
end $$;
