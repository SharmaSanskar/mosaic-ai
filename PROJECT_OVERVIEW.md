# Mosaic

A real-time collaborative workspace where multiple people **and an AI participant** share a room together: a live chat, a reasoning graph the AI builds from the conversation, and a pinned "moodboard" of decisions worth keeping. Built to explore what a multi-user product looks like when one of the users is a language model.

This document is written for anyone evaluating the project — what it does, how it's built, and the specific engineering decisions worth talking about. For setup/run instructions, see `README.md`.

## Stack

- **Frontend:** Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 + shadcn/ui (Base UI) + React Flow
- **Backend:** Go — a hand-rolled WebSocket hub (no framework), chi router
- **Database/Auth:** Supabase (Postgres + Auth), accessed via PostgREST
- **LLM:** OpenAI `gpt-4o-mini`, streamed

## Features

**Real-time multi-user chat.** Everyone in a room sees everyone else's messages instantly over a WebSocket connection. The Go backend owns each room's live state; Supabase persists history.

**An AI participant, not a bot bolted on the side.** Tag `@AI` anywhere in a message and the assistant streams a reply token-by-token, visible to everyone in the room simultaneously — not just the person who asked. A per-room mutex ensures two overlapping `@AI` mentions can't trigger concurrent generations stepping on each other's context.

**A reasoning graph that builds itself.** After every AI reply, a second background call asks the model to represent the conversation so far as a small DAG — topics, questions, decisions, and actions, with edges between them — rendered live with React Flow. It's not a static diagram; it regenerates and updates in front of you as the conversation evolves.

**A shared moodboard.** Any message — from a human or the AI — can be pinned. Pins sync to everyone in the room instantly and persist across reloads.

**Rate limiting and token observability.** Each connection carries its own token-bucket limiter (spam gets a warning, not a ban). Every OpenAI call's token usage is captured and rolled into a live per-room counter visible in the UI.

**A resizable, collapsible 3-pane layout.** Chat, graph, and moodboard can each be resized or collapsed, with layout preferences persisted across sessions.

## Architecture

```
Browser (Next.js)  ──HTTP/Auth──►  Supabase (Postgres + Auth)
       │      ▲
   WebSocket   │
       ▼      │
Go WebSocket Hub  ──REST──►  Supabase (reads/writes room state)
       │
       └──────────────►  OpenAI (chat completions, streamed)
```

The Go service is the source of truth for a room's *live* state (who's connected, in-flight AI generations); Supabase is the durable store. The frontend never talks to OpenAI directly — everything routes through the Go hub, which is also where rate limiting and token accounting live.

## Notable engineering decisions

A few things worth digging into if you're reviewing this project:

**One goroutine per room, no locks on the hot path.** Each chat room is a `Room` struct in `backend/hub.go` with its own `run()` goroutine — the *only* code allowed to touch that room's client list. Everything else (incoming messages, AI streaming, graph updates) communicates with it exclusively through channels. This gets you race-free concurrent state without a mutex guarding the common case; the one place a mutex *is* used (`aiBusy`) is specifically to serialize something that genuinely needs serializing — concurrent calls to the same OpenAI conversation.

**A signing-method bug caught by testing against the real thing, not assumptions.** Supabase's newer default is asymmetric JWT signing keys (ES256, served over JWKS) rather than the legacy shared HS256 secret most tutorials assume. The first implementation assumed HS256; live-testing against the actual running instance immediately failed. The fix (`backend/jwks.go`) fetches and caches Supabase's public keys and dispatches on the token's actual signing algorithm, supporting both — a small reminder that "it matches the docs" and "it works against the real service" aren't the same claim.

**Token increments go through a Postgres function, not a PATCH.** PostgREST can express `SET x = <literal>` but not `SET x = x + <n>` — there's no way to send "increment by N" as a REST body. `total_tokens_used` is incremented via an RPC to a small `increment_room_tokens(room_id, amount)` Postgres function instead, so concurrent increments from multiple in-flight AI calls can't race and clobber each other the way a read-then-write from the application layer would.

**The reasoning graph is regenerated, not merged, on every update.** The tempting design is to diff the new graph against the old one and merge by node ID. The model doesn't guarantee stable IDs across calls, so merging risks silently orphaned or duplicated nodes. Instead, each update asks the model to represent the *whole* conversation again and the previous graph is replaced outright — simpler, and it can't drift into an inconsistent state.

**The graph's colors are validated, not chosen by eye.** The four node types (topic/question/decision/action) are colored using a categorical-palette methodology that runs an actual colorblind-simulation + contrast check (`validate_palette.js`) rather than picking colors that "look distinct" — the four hues in use are the specific ones confirmed to clear CVD-separation and contrast thresholds together, not just individually.

**One WebSocket connection per room, not one per component.** Each of the three panes (chat, graph, moodboard) originally opened its own socket independently — functionally fine, but it meant one human registered as *four* separate clients in the Go hub, each with its own rate-limit bucket, effectively quadrupling their spam allowance. Consolidated into a single connection shared via React Context (`frontend/src/lib/room-socket-context.tsx`), fixing both the inefficiency and the underlying rate-limit bug at once.

**Client-side reconnection with backoff, not a silent drop.** If the WebSocket connection drops, the client automatically retries with exponential backoff (capped) rather than leaving the UI silently stale — reconnection was verified for real by killing and restarting the backend mid-session and watching the browser tab recover on its own.

## What's deliberately out of scope (for now)

- LangSmith tracing was planned but deferred — token-usage tracking ships without full distributed tracing.
- No per-room access control — any authenticated user can read/write any room. Fine for a single trusted workspace; would need a membership model before this became multi-tenant.
- No dark-mode toggle yet, though the design tokens for one already exist in `globals.css`.
