-- Room management: rename (any member) and delete (owner only).
-- Phase D's RLS left public.rooms with no UPDATE/DELETE policy, so these writes
-- go through SECURITY DEFINER RPCs (same pattern as create_room/join_room). This
-- keeps them scoped: rename only touches the name column, delete is owner-gated.

create or replace function public.rename_room(p_room uuid, p_name text)
returns void language plpgsql security definer as $$
begin
  if not public.is_room_member(p_room, auth.uid()) then
    raise exception 'not a member of this room';
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'room name cannot be empty';
  end if;
  update public.rooms set name = trim(p_name) where id = p_room;
end; $$;
grant execute on function public.rename_room(uuid, text) to authenticated;

create or replace function public.delete_room(p_room uuid)
returns void language plpgsql security definer as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room and created_by = auth.uid()
  ) then
    raise exception 'only the room owner can delete it';
  end if;
  delete from public.rooms where id = p_room; -- cascades to messages, members, room_agents
end; $$;
grant execute on function public.delete_room(uuid) to authenticated;
