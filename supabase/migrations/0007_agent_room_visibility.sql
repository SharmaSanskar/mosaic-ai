-- Phase B2: let any authenticated user read an agent that is attached to a room,
-- regardless of who created it. Without this, a custom agent created by user A
-- would be invisible to user B in the same room (RLS would hide the row), and
-- B's chat couldn't attribute A's agent's messages by name/color.
-- (This stays permissive until Phase D narrows it to room membership.)
create policy "read agents attached to any room" on public.agents
  for select to authenticated
  using (exists (select 1 from public.room_agents ra where ra.agent_id = agents.id));
