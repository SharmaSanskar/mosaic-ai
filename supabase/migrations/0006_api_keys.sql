-- Phase B2: bring-your-own API keys (encrypted at rest).
-- Users can store their own provider API keys so their custom agents can run on
-- Anthropic/Google/etc. without the platform paying. Keys are encrypted by the
-- Go backend (AES-256-GCM) before they ever reach this table; only the backend's
-- service_role can read the ciphertext. The frontend never touches this table.

create table public.api_keys (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  provider   text not null,              -- 'openai' | 'anthropic' | 'google'
  label      text not null default '',
  ciphertext text not null,              -- base64(AES-256-GCM ciphertext)
  nonce      text not null,              -- base64(GCM nonce)
  last4      text not null default '',   -- for display only
  created_at timestamptz not null default now()
);
create index on public.api_keys(owner_id);

-- Lock this table to the backend only. Revoke the broad grants that 0001's
-- default privileges would otherwise extend to the client roles, and enable RLS
-- with NO policy for authenticated/anon, so even a direct PostgREST call with a
-- user token cannot read the ciphertext. service_role bypasses RLS.
revoke all on public.api_keys from anon, authenticated;
grant all on public.api_keys to service_role;
alter table public.api_keys enable row level security;

-- Now that api_keys exists, point agents.api_key_id at it.
alter table public.agents
  add constraint agents_api_key_id_fkey
  foreign key (api_key_id) references public.api_keys(id) on delete set null;

-- An agent may only reference a key owned by that same agent's owner. Without
-- this, a user could create an agent pointing at another user's key id and,
-- while never able to read the key, still cause the backend to decrypt and use
-- it. The trigger is SECURITY DEFINER so it can read api_keys (locked to the
-- backend role) to perform the ownership check.
create or replace function public.check_agent_api_key_owner() returns trigger
language plpgsql security definer as $$
begin
  if new.api_key_id is not null then
    if not exists (
      select 1 from public.api_keys k
      where k.id = new.api_key_id and k.owner_id = new.owner_id
    ) then
      raise exception 'api_key_id must reference a key owned by the agent owner';
    end if;
  end if;
  return new;
end; $$;

create trigger agents_api_key_owner_check
  before insert or update on public.agents
  for each row execute function public.check_agent_api_key_owner();
