-- Phase A: generative visualization.
-- The reasoning view is no longer a fixed {nodes,edges} DAG; the AI now authors
-- whichever Mermaid diagram best describes the conversation. Store it in a new
-- column. The old graph_state column is left in place for now (dropped in a
-- later cleanup) so existing rows are untouched.
alter table public.rooms
  add column if not exists viz_state jsonb not null default '{}'::jsonb;
