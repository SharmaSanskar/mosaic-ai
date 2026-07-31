# Mosaic

Real-time collaborative workspace where multiple users and an AI agent interact simultaneously — shared chat, a live reasoning graph (DAG), a synced moodboard of pinned agreements, and service-health/observability.

## Stack
- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui + React Flow (`@xyflow/react`)
- **Backend:** Go 1.25 (chi + gorilla/websocket) — WebSocket hub, room state, rate limiting, OpenAI calls
- **Database/Auth:** Supabase (local, Postgres) — email/password auth
- **LLM:** OpenAI `gpt-4o-mini`

## Layout
```
frontend/   Next.js app
backend/    Go WebSocket + HTTP server
supabase/   Local Supabase config + migrations
```

## Prerequisites
- Node 20+, Go 1.25+, Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`)

## First-time setup
1. **Start Docker Desktop** (the Docker daemon must be running).
2. From the repo root, start the local Supabase stack:
   ```bash
   supabase start
   ```
   This prints the API URL, anon key, service_role key, JWT secret, and Studio URL (http://127.0.0.1:54323).
3. **Frontend env:** `cp frontend/.env.local.example frontend/.env.local` and fill in the anon key.
4. **Backend env:** `cp backend/.env.example backend/.env` and fill in the service_role key, JWT secret, and your `OPENAI_API_KEY`.

## Run (three terminals)
```bash
# 1. Supabase (once per session)
supabase start

# 2. Backend
cd backend && go run .        # http://localhost:8080  (GET /health)

# 3. Frontend
cd frontend && npm run dev    # http://localhost:3000
```

## Verify
```bash
curl localhost:8080/health    # {"status":"ok"}
supabase status               # all services healthy
```
