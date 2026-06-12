-- T234 Phase 3: pre-signup account lookup for the coach email step.
-- Called ANON (no session) from the coach signup email screen so the flow
-- can branch BEFORE creating anything: existing athlete -> in-flow
-- "continue as coach?" confirm + password verify; existing coach ->
-- sign-in prompt.
--
-- Exposure note: account-existence is already discoverable via signUp's
-- user_already_exists error, so this adds no new enumeration surface.
-- Returns ONLY { exists } or { exists, marker } -- no names, no ids.
create or replace function public.check_account_status(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_marker text;
begin
  select id into v_uid
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_uid is null then
    return jsonb_build_object('exists', false);
  end if;

  select account_marker into v_marker
  from public.profiles
  where id = v_uid;

  return jsonb_build_object(
    'exists', true,
    'marker', coalesce(v_marker, 'A')
  );
end
$$;

grant execute on function public.check_account_status(text) to anon, authenticated;
