create extension if not exists "pgcrypto";

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text unique,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  graph_state jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  artifacts_state jsonb not null default '[]'::jsonb,
  total_tokens_used integer not null default 0
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id text not null,              -- auth user uuid as text, or the literal 'AI'
  content text not null,
  created_at timestamptz not null default now()
);
create index on public.messages(room_id, created_at);

-- Auto-provision a public.users row on signup
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.users(id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Base table-level grants: RLS policies below only filter rows, they don't
-- substitute for the GRANTs Postgres requires before a role can touch a table.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- RLS (MVP): authenticated users read/write; server uses service_role to bypass
alter table public.rooms enable row level security;
alter table public.messages enable row level security;
alter table public.users enable row level security;
create policy "auth read rooms"  on public.rooms  for select to authenticated using (true);
create policy "auth create rooms" on public.rooms for insert to authenticated with check (true);
create policy "auth read messages" on public.messages for select to authenticated using (true);
create policy "auth read self" on public.users for select to authenticated using (auth.uid() = id);
