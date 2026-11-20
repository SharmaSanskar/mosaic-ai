-- Phase B1: multi-agent rooms.
-- An "agent" is an AI participant with its own @handle, persona, provider, and
-- model. Platform-default agents (owner_id is null) run on the platform OpenAI
-- key and are available in every room. User-created agents (owner_id set) are
-- added to specific rooms via room_agents, and may point at a BYO api key
-- (api_key_id, wired up in Phase B2).

create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references auth.users(id) on delete cascade, -- null = platform default
  name          text not null,
  handle        text not null,                 -- @handle: lowercase, no spaces
  system_prompt text not null default '',
  provider      text not null default 'openai',-- 'openai' | 'anthropic' | 'google'
  model         text not null,
  api_key_id    uuid,                           -- -> api_keys(id); null = platform key (FK added in B2)
  color         text,                           -- optional UI accent (hex)
  created_at    timestamptz not null default now()
);
create index on public.agents(owner_id);

-- Custom (non-platform) agents attached to a room.
create table public.room_agents (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  agent_id  uuid not null references public.agents(id) on delete cascade,
  added_by  uuid,
  added_at  timestamptz not null default now(),
  primary key (room_id, agent_id)
);

-- Grants (RLS below only filters rows; GRANTs are still required per role).
grant all on public.agents       to anon, authenticated, service_role;
grant all on public.room_agents  to anon, authenticated, service_role;

-- RLS. The Go backend uses service_role and bypasses these; the frontend uses
-- the authenticated role for reads.
alter table public.agents enable row level security;
alter table public.room_agents enable row level security;

-- Anyone authenticated can read platform agents or their own.
create policy "read platform or own agents" on public.agents
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());
-- Users manage only their own agents.
create policy "insert own agents" on public.agents
  for insert to authenticated with check (owner_id = auth.uid());
create policy "update own agents" on public.agents
  for update to authenticated using (owner_id = auth.uid());
create policy "delete own agents" on public.agents
  for delete to authenticated using (owner_id = auth.uid());

-- room_agents: permissive for now; tightened to room membership in Phase D.
create policy "read room agents"   on public.room_agents for select to authenticated using (true);
create policy "insert room agents" on public.room_agents for insert to authenticated with check (true);
create policy "delete room agents" on public.room_agents for delete to authenticated using (true);

-- Seed platform default agents (owner_id null -> run on the platform OpenAI key).
-- Colors reuse the colorblind-validated accents from the previous graph palette.
insert into public.agents (owner_id, name, handle, system_prompt, provider, model, color) values
  (null, 'Assistant', 'assistant',
   'You are a helpful AI participant in Mosaic, a real-time collaborative chat room shared by multiple humans. Respond concisely and helpfully to the conversation, especially the most recent message.',
   'openai', 'gpt-4o-mini', '#2a78d6'),
  (null, 'Researcher', 'researcher',
   'You are Researcher, an analytical AI participant in a shared chat room. Dig into the substance: surface relevant facts, frameworks, trade-offs, and concrete details. Be rigorous and specific, show your reasoning briefly, and stay concise.',
   'openai', 'gpt-4o', '#1baf7a'),
  (null, 'Critic', 'critic',
   'You are Critic, a skeptical AI participant in a shared chat room. Stress-test ideas: point out risks, weak assumptions, and failure modes, and say what would make an idea stronger. Be direct but constructive, and concise.',
   'openai', 'gpt-4o-mini', '#eb6834');
