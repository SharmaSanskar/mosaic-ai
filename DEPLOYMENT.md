# Deploying Mosaic

A live, shareable URL. Three pieces, all with free tiers:

| Component | Host | Why |
|---|---|---|
| Postgres + Auth | **Supabase** (hosted project) | DB, auth, RLS |
| Go WebSocket hub | **Fly.io** | long-lived WebSockets + TLS |
| Next.js frontend | **Vercel** | first-class Next.js hosting |

> Your local setup uses Supabase on `127.0.0.1`. Production needs a **hosted** Supabase project — the steps below migrate your schema to it. Everything still runs on your single OpenAI key; other providers remain bring-your-own.

Deploy order matters (each piece needs the previous one's URL): **Supabase → Backend → Frontend → fix CORS**.

---

## 1. Hosted Supabase

1. Create a project at https://supabase.com/dashboard (note the **DB password**).
2. From the repo root, link and push your migrations to it:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push         # applies migrations 0001–0008 to the cloud DB
   ```
3. In the dashboard, grab these (Project Settings):
   - **Project URL** → `https://<ref>.supabase.co`  (this is `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`)
   - **API keys** → `anon` (public) and `service_role` (secret)
   - **JWT secret** (Auth → "JWT Settings", legacy secret) — only needed if your project uses HS256; the backend also auto-handles the newer ES256/JWKS mode, so this can be left blank on new projects.
4. **Auth settings** (so signup/login work on the deployed domain):
   - Auth → URL Configuration → set **Site URL** to your Vercel URL (added in step 3 below; you can come back).
   - For a quick demo, Auth → Providers → Email → consider turning **off** "Confirm email" so new signups work instantly.

---

## 2. Backend on Fly.io

```bash
# once: install flyctl and log in
brew install flyctl && fly auth login

cd backend
# edit fly.toml: set `app` to a unique name, e.g. mosaic-backend-<you>
fly launch --no-deploy            # creates the app from the existing fly.toml

# set secrets (NOT committed) — use your hosted Supabase values:
fly secrets set \
  SUPABASE_URL="https://<ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service_role key>" \
  SUPABASE_JWT_SECRET="<jwt secret, or omit on ES256 projects>" \
  OPENAI_API_KEY="<your OpenAI key>" \
  ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  CORS_ORIGIN="https://PLACEHOLDER.vercel.app"    # fix in step 4

fly deploy
```

Your backend is now at `https://<app>.fly.dev`. The browser will use `wss://<app>.fly.dev`.

> **Keep `ENCRYPTION_KEY` stable forever** — if it changes, previously stored BYO keys can't be decrypted. Generate it once here and don't rotate it casually.

---

## 3. Frontend on Vercel

1. Import the repo at https://vercel.com/new. Set **Root Directory** to `frontend`.
2. Environment variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   NEXT_PUBLIC_WS_URL=wss://<app>.fly.dev
   ```
3. Deploy. Note the resulting URL, e.g. `https://mosaic-<you>.vercel.app`.

---

## 4. Wire CORS + Auth to the real frontend URL

```bash
cd backend
fly secrets set CORS_ORIGIN="https://mosaic-<you>.vercel.app"   # triggers a redeploy
```
Then in Supabase → Auth → URL Configuration, set **Site URL** to the same Vercel URL.

---

## 5. Verify in production

Open the Vercel URL on two devices / networks and confirm, over `wss://`:
- Sign up / log in.
- Create a room (note its share code) and **join it from the second device** by code.
- A non-member hitting `/room/<id>` is bounced (access control) and the WS upgrade is refused.
- `@researcher` and `@critic` reply concurrently; the generative Mermaid diagram renders.
- Presence avatars + typing indicators work across the two devices.
- Add a BYO key and a custom agent (tested end-to-end with your OpenAI key).

---

## Notes

- **Scale-to-zero:** `fly.toml` lets the backend sleep when idle; the first request after idle has a short cold start. An open WebSocket keeps it awake. For an always-warm demo, set `min_machines_running = 1`.
- **Cost:** Vercel Hobby, Fly.io free allowance, and Supabase Free tier cover a demo. The only usage cost is your OpenAI calls (fractions of a cent each on `gpt-4o-mini`).
- **Secrets never ship in the image:** `.dockerignore` excludes `.env`; all backend secrets live in `fly secrets`.
