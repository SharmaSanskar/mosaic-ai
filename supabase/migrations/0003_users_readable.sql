-- Shared collaborative rooms need participant names visible to everyone,
-- not just to the user themselves. rooms/messages are already select-all
-- for authenticated users with no room-membership check, so this brings
-- users in line with that same trust model rather than introducing a new
-- exposure class.
drop policy if exists "auth read self" on public.users;

create policy "auth read all users" on public.users
  for select to authenticated using (true);
