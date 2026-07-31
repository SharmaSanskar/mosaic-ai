-- Atomic increment for rooms.total_tokens_used. PostgREST can't express
-- "increment by N" as a PATCH body (values are literals, not SQL
-- expressions), so this is exposed as an RPC instead.
create or replace function public.increment_room_tokens(room_id uuid, amount integer)
returns integer
language plpgsql
security definer
as $$
declare
  new_total integer;
begin
  update public.rooms
  set total_tokens_used = total_tokens_used + amount
  where id = room_id
  returning total_tokens_used into new_total;

  return new_total;
end;
$$;

grant execute on function public.increment_room_tokens(uuid, integer) to service_role;
