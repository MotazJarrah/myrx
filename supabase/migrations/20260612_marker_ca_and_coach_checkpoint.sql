-- T241: directional transient markers + separate coach journey tracker.
--
-- Marker set becomes A | AC | CA | C | D:
--   AC = switching athlete -> coach (web coach signup is the active journey)
--   CA = switching coach -> athlete (mobile athlete journey is the active one)
-- Settle law (user-locked): a transient can ONLY settle by completing a
-- journey — coach welcome-end + payment -> C; mobile athlete welcome-end ->
-- A. Flips between AC and CA happen only via explicit decision screens
-- (mobile coach-pending "switch to athlete" -> CA; web "continue my coach
-- signup" -> AC).
alter table public.profiles drop constraint if exists profiles_account_marker_check;
alter table public.profiles
  add constraint profiles_account_marker_check
  check (account_marker in ('A','AC','CA','C','D'));

-- The coach journey's OWN "where am I" ('plan' / 'stripe' / 'welcome-end'),
-- stamped only by the web coach signup. The athlete journey's
-- signup_checkpoint is never touched by the coach flow again — sharing one
-- column is what let a mid-athlete conversion get its athlete resume
-- position overwritten with 'plan' (mobile's resume then fell through to
-- welcome-end and incorrectly completed the journey).
alter table public.profiles
  add column if not exists coach_signup_checkpoint text;
