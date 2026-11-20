-- Phase D: room membership & access control.
-- Until now any authenticated user could read/write any room. This adds a
-- membership model: a room has members (an owner + joiners), and RLS + the WS
-- handshake only let members in. Rooms are joined by a short share code.

-- 1. Membership table ------------------------------------------------------
create table public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member',  -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
grant all on public.room_members to anon, authenticated, service_role;
alter table public.room_members enable row level security;
-- Members can see their own membership rows.
create policy "read own memberships" on public.room_members
  for select to authenticated using (user_id = auth.uid());
-- (No client insert policy: membership is granted only via the owner trigger or
--  the join_room RPC below, both SECURITY DEFINER.)

-- 2. Membership check used by RLS. SECURITY DEFINER so it reads room_members
--    without triggering that table's RLS (avoids recursive policy evaluation).
create or replace function public.is_room_member(p_room uuid, p_user uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = p_user
  );
$$;

-- 3. Room ownership + share code ------------------------------------------
alter table public.rooms add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.rooms add column if not exists join_code text;
update public.rooms
  set join_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  where join_code is null;
alter table public.rooms alter column join_code set default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
alter table public.rooms alter column join_code set not null;
create unique index if not exists rooms_join_code_key on public.rooms(join_code);

-- On insert, stamp the creator and add them as the owner member.
create or replace function public.handle_new_room() returns trigger
language plpgsql security definer as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end; $$;
create trigger rooms_set_creator before insert on public.rooms
  for each row execute function public.handle_new_room();

create or replace function public.add_room_owner() returns trigger
language plpgsql security definer as $$
begin
  if new.created_by is not null then
    insert into public.room_members(room_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger rooms_add_owner after insert on public.rooms
  for each row execute function public.add_room_owner();

-- 4. Backfill: so existing rooms/data stay accessible, make every current user
--    a member of every existing room. (New rooms use the ownership model above.)
insert into public.room_members(room_id, user_id, role)
  select r.id, u.id, 'member'
  from public.rooms r cross join auth.users u
  on conflict do nothing;

-- 5. Join-by-code RPC. SECURITY DEFINER so a non-member can find the room by its
--    code and add themselves, without rooms being otherwise readable to them.
create or replace function public.join_room(p_code text) returns uuid
language plpgsql security definer as $$
declare r_id uuid;
begin
  select id into r_id from public.rooms where join_code = lower(p_code);
  if r_id is null then
    raise exception 'room not found';
  end if;
  insert into public.room_members(room_id, user_id, role)
  values (r_id, auth.uid(), 'member')
  on conflict do nothing;
  return r_id;
end; $$;
grant execute on function public.join_room(text) to authenticated;

-- 5b. Create-room RPC. Returns the new row (with join_code) directly, avoiding
--     the RLS-on-RETURNING timing issue where the owner membership is only added
--     by the AFTER-INSERT trigger.
create or replace function public.create_room(p_name text) returns public.rooms
language plpgsql security definer as $$
declare r public.rooms;
begin
  insert into public.rooms(name, created_by) values (p_name, auth.uid())
  returning * into r;
  return r;
end; $$;
grant execute on function public.create_room(text) to authenticated;

-- 6. Tighten RLS: replace the permissive "anyone authenticated" policies with
--    membership-scoped ones.
drop policy if exists "auth read rooms" on public.rooms;
create policy "members read rooms" on public.rooms
  for select to authenticated using (public.is_room_member(id, auth.uid()));

drop policy if exists "auth read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_room_member(room_id, auth.uid()));

drop policy if exists "read room agents" on public.room_agents;
drop policy if exists "insert room agents" on public.room_agents;
drop policy if exists "delete room agents" on public.room_agents;
create policy "members read room agents" on public.room_agents
  for select to authenticated using (public.is_room_member(room_id, auth.uid()));
create policy "members add room agents" on public.room_agents
  for insert to authenticated with check (public.is_room_member(room_id, auth.uid()));
create policy "members remove room agents" on public.room_agents
  for delete to authenticated using (public.is_room_member(room_id, auth.uid()));

-- Agents attached to a room are readable to that room's members (for attribution).
drop policy if exists "read agents attached to any room" on public.agents;
create policy "read agents in my rooms" on public.agents
  for select to authenticated using (
    exists (
      select 1 from public.room_agents ra
      where ra.agent_id = agents.id and public.is_room_member(ra.room_id, auth.uid())
    )
  );
