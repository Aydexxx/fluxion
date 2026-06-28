# Fluxion

An AI workflow automation platform with visual, agent-based pipelines — build a
DAG of triggers, actions, AI nodes, and logic on a canvas, run it, and watch
each node light up live as it executes.

## Architecture

Fluxion is a monorepo with two workspaces, `server` and `web`, that share one
Postgres database and one Redis instance.

The **editor** (React + [React Flow](https://reactflow.dev)) lets you drag
nodes onto a canvas and wire them into a DAG. Saving a workflow sends its
definition to the **API** (Express), which validates the graph (no cycles, no
dangling edges, known node types) and persists it with Prisma. Pressing *Run*
doesn't execute anything inline — the API just enqueues a job on the
**queue** (BullMQ on Redis) and returns immediately with a `queued` run.

A separate **worker** process (its own Node entrypoint, scaled independently
from the API) pulls jobs off that queue and hands each one to the shared
**execution engine**: a topological-sort runner that resolves each node's
`{{template}}` references against the trigger payload and upstream outputs,
calls the right **node executor** (HTTP request, database query, email, Slack
webhook, LLM call, agent loop, filter/loop/condition, etc.), and records the
result. Credentials are decrypted only here, at the worker, scoped to the
run's workspace — they're never sent to the browser or held in plaintext
anywhere else. Failed runs retry with backoff and eventually dead-letter
without crashing the worker.

As the worker executes a run, it pushes lifecycle events (`run:started`,
`node:started`, `node:finished`, `run:finished`) **and structured log lines**
over **Socket.IO**, scoped to a per-run room and fanned out across processes via
a Redis adapter. The editor subscribes to its active run's room and updates each
node's status pill on the canvas in real time — no polling — while the run-detail
view tails the same stream into a live timeline and log console.

The same Socket.IO layer carries **ephemeral presence** for real-time
collaboration: open editors join a per-*workflow* room and broadcast cursors,
selection, edit locks, and live graph edits to each other (see
[Real-time collaboration](#real-time-collaboration)).

Editing only ever mutates a workflow's **draft**; publishing snapshots an
immutable **version** and promotes it to what triggers actually run, so the live
automation is decoupled from in-progress edits and any past version can be
previewed or rolled back (see [Versioning](#workflow-versioning)).

Workflows can also start from an inbound **webhook** (an unguessable
per-workflow URL) or a **cron schedule** (BullMQ job schedulers reconciled
against each workflow's `trigger.schedule` nodes), in addition to a manual
*Run* click. A `flow.subworkflow` node calls **another workflow as a step**,
recording the nested run against its parent for end-to-end traceability.

Everything is **multi-tenant**: data is scoped to a **workspace**, and every API
route re-checks the caller's role (owner / admin / editor / viewer) — the React
client only mirrors those rules to hide what a role can't use. Workspaces are
shared by email **invite**, and privileged actions append to an **audit log**
while emitting **notifications** (persisted and pushed over Socket.IO).
Workspace-scoped **variables** (plain) and **secrets** (encrypted, never returned
to the client) are interpolated into node configs alongside credentials. Beyond
the session API the browser uses, a separate **public REST API** (`/api/v1`,
authenticated by hashed, scoped **API keys** with their own rate limiter) lets
external systems list and trigger workflows and read runs.

```
 Editor (React Flow) ──save──▶ API (Express) ──enqueue──▶ Queue (BullMQ/Redis)
      ▲                              │                          │
      │                         Postgres (Prisma)                ▼
      └──────── Socket.IO (live status) ◀────── Worker ◀── Execution Engine
                                                     │
                                          Node executors (HTTP, DB, Email,
                                          Slack, LLM, Agent, Logic, …)
```

## Tech stack

- **Server:** Node.js, TypeScript, Express, Prisma + PostgreSQL, BullMQ +
  Redis (queue, cron schedulers, Socket.IO adapter), Socket.IO, Zod
  validation, Pino logging, JWT auth, bcrypt.
- **Web:** React, Vite, TypeScript, [@xyflow/react](https://reactflow.dev)
  (the node-graph canvas), Zustand, Tailwind CSS, Axios, Socket.IO client,
  Recharts (analytics), Framer Motion.
- **Testing:** Vitest (+ Supertest for HTTP routes) in both workspaces.
- **CI:** GitHub Actions — lint, typecheck, and test both workspaces on every
  push/PR, with real Postgres + Redis service containers.

## Features

- **Visual workflow editor** — drag-and-drop DAG canvas with live validation,
  per-node config forms, and a results/inspector panel.
- **Node library:**
  - *Triggers:* manual, webhook, cron schedule
  - *Actions:* HTTP request, transform (JS-free data shaping), email (SMTP),
    Slack/Discord webhook, database query (read-only by default)
  - *Integrations:* GitHub (issues/comments) and Notion (pages), credential-backed
  - *AI:* a single LLM call, and a multi-step tool-using agent
  - *Logic:* condition (branching), loop/iterate, filter
  - *Sub-workflows:* call another workflow as a node, with nested run tracking
  - *Output:* response
- **Visual data mapping** — a data picker reads the live shape of every upstream
  node's output (and the trigger payload) so you point-and-click `{{references}}`
  instead of guessing field paths, and **test a single node in isolation**
  against real or pinned sample data without running the whole graph.
- **Workflow versioning** — a draft/publish model: edits touch only the draft;
  publishing snapshots an immutable, authored version; any version can be
  previewed read-only and rolled back. See [Versioning](#workflow-versioning).
- **Error handling** — per-node retry with backoff and an explicit on-error
  policy (*stop* / *continue* / *route to an error branch*) for try/catch-style
  flows, plus optional **failure alerts** (Slack/email) when a run dead-letters.
- **Templates** — a **Built-in** gallery of one-click, pre-wired example
  workflows (with sample data baked in, so a new workflow runs the moment it
  opens), plus **My Templates**: save any workflow as a reusable, workspace-scoped
  template (credential bindings stripped so no secret is ever captured), then
  rename, edit, and instantiate it like the built-ins.
- **Workflow organization** — group a growing workflow list into **folders** and
  reusable **tags**; the dashboard adds search, sort, status/tag filters behind a
  compact toolbar, a folder breadcrumb, and folder-aware creation.
- **Execution engine** — topological DAG execution, `{{template}}`
  interpolation across trigger payload + upstream outputs, per-node timeouts,
  and full run/node-execution history for replay and debugging.
- **Queue + worker** — BullMQ-backed retries with exponential backoff,
  dead-lettering after exhausted attempts, idempotent job processing, and
  independently scalable worker concurrency.
- **Live run status** — Socket.IO push updates so the canvas reflects a run's
  progress node-by-node as it happens.
- **Run observability** — a dedicated run view with a Gantt-style execution
  timeline, a node-by-node inspector (input/output/error/timing/retries),
  per-run structured logs streamed live, and a workspace runs list with
  filters, search, and cursor-based infinite scroll. See
  [Run observability](#run-observability).
- **Real-time collaboration** — open the same workflow in two places and see
  each other live: presence avatars, smoothly-interpolated labeled cursors,
  selection highlights, a non-blocking "X is editing" soft-lock, and graph edits
  that appear in near-real-time. See [Real-time collaboration](#real-time-collaboration).
- **Encrypted credential vault** — see below.
- **Workspaces, RBAC & sharing** — JWT auth and multi-user workspaces with four
  roles — **owner / admin / editor / viewer** — enforced on every route. Share a
  workspace by email **invite** (accepted from an in-app inbox), manage members
  and roles, and never grant a role above your own. The UI hides what a role
  can't use; the server is always the source of truth.
- **Audit log** — an admin/owner-only, filterable feed of who did what (invites,
  role changes, publishes, credential and workflow changes, failed runs), keyset-
  paginated and self-contained (the actor name survives the actor being removed).
- **In-app notifications** — invites, role changes, and run failures arrive as
  persisted notifications, pushed live over Socket.IO to every open tab with an
  unread badge.
- **Variables & secrets** — workspace-scoped, reusable values referenced in node
  configs via `{{ vars.KEY }}` and `{{ secrets.KEY }}`. Variables are plain
  values; secrets are AES-256-GCM encrypted at rest and **never returned to the
  client** — decrypted only at execution time, like credentials.
- **Public REST API** — a separate, API-key-authenticated surface (`/api/v1`)
  for listing/triggering workflows and reading runs programmatically, with
  scoped, hashed keys and per-key rate limiting (distinct from the session API).
- **User profiles** — edit display name, upload a cropped **avatar** (shown in the
  nav, presence, members list, and audit log), change password (current-password
  verified), and set preferences (e.g. default landing section).
- **App shell & navigation** — a calm slim top bar (brand, workspace switcher,
  primary tabs, notifications, profile) over a collapsible left **side panel**
  that groups Workspace (Runs, Analytics) and Settings (Members, Credentials,
  Variables, API keys, Activity) by role. On phones it becomes a drawer; the whole
  app is responsive and the desktop-first canvas shows a friendly read-only gate
  on mobile.
- **Onboarding** — a short, dismissible, reduced-motion-aware guided tour that
  spotlights templates (on the dashboard) and the node palette, run, data picker,
  and publish (in the editor) for first-time users, remembered once finished.
- **Runs dashboard & analytics** — searchable run history, replay a past run,
  and aggregate charts (success/failure over time, top-failing workflows and
  nodes).
- **Rate limiting & structured logging** — abuse-resistant auth/webhook
  endpoints, correlation-id-tagged Pino logs.

## Local setup

### 1. Infrastructure

```bash
docker-compose up -d
```

This starts Postgres and Redis on the ports the app expects out of the box
(`localhost:5432`, `localhost:6379` — see `docker-compose.yml`).

### 2. Environment variables

```bash
cp server/.env.example server/.env
```

The defaults in `server/.env.example` already match `docker-compose.yml`. Key
variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string (queue + Socket.IO adapter) |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Auth token signing |
| `CREDENTIALS_KEY` | Master key for the credential vault (see below) |
| `LLM_PROVIDER` | `none` \| `ollama` \| `openai` (see [AI providers](#ai-providers)) |
| `QUEUE_MAX_ATTEMPTS` / `QUEUE_BACKOFF_MS` / `WORKER_CONCURRENCY` | Queue/worker tuning |
| `RATE_LIMIT_ENABLED` and friends | Auth/webhook rate limiting |

### 3. Install + migrate

```bash
npm install                      # installs both workspaces (root, npm workspaces)
npm run prisma:migrate --workspace=server   # or: cd server && npx prisma migrate dev
```

### 4. Run it

In three terminals:

```bash
npm run dev:server   # API on :4000
npm run dev:worker    # picks up queued runs
npm run dev:web       # editor on :5173
```

Visit `http://localhost:5173`, register an account, and build a workflow.

## AI providers

The `ai.llm` and `ai.agent` nodes call out through a single provider-agnostic
layer, selected via `LLM_PROVIDER` in `server/.env`:

- **`none`** (default in CI/tests) — a deterministic offline stub. No network
  calls, no keys required; lets the whole engine (and its test suite) run
  fully offline.
- **`ollama`** (dev default) — calls a local/self-hosted
  [Ollama](https://ollama.com) server (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`). No
  API key needed, just `ollama serve` running locally.
- **`openai`** — OpenAI-compatible chat completions (`OPENAI_BASE_URL`,
  `OPENAI_MODEL`, `OPENAI_API_KEY`). Wired end-to-end but **intentionally
  inert until `OPENAI_API_KEY` is set** — activating it is deferred to
  whoever deploys with a real key, never hardcoded.

Each `ai.*` node can also override the model per-node; the env setting is just
the default.

## Workflow versioning

Every workflow has a **draft** (what the editor edits) and, once published, a
**published definition** (what active webhook/schedule triggers run). The two are
deliberately separate:

- **Editing is safe.** Saving only ever writes the draft, so in-progress edits
  can't change what's running in production. A badge shows when the draft has
  drifted from the live version.
- **Publishing snapshots a version.** Each publish writes an immutable
  `WorkflowVersion` (monotonic number, author, note, and the exact definition)
  and promotes it to the published definition.
- **History, preview & rollback.** The version drawer lists every published
  version with a compact diff (nodes added/removed/changed, edges) against the
  one before it. Any version can be previewed read-only on the canvas, or rolled
  back — which simply republishes it as a new version (history is append-only).

A queued run also snapshots the exact definition it will execute, so editing or
rolling back never alters a run that's already in flight.

## Run observability

When a run misbehaves, the run view (`/runs/:id`) is what you reach for:

- **Execution timeline** — a Gantt-style chart with one bar per node, placed by
  start offset and sized by duration, colored by status. In-progress bars grow
  live; bars show a retry count (`↻N`) when a node was re-attempted.
- **Node inspector** — click any node to see its exact input, output, error,
  timing, and attempt count.
- **Structured logs** — every run emits ordered, level-tagged log lines keyed by
  the run id (the correlation id, shown in the header). They stream in live as
  the run executes and are retained for later inspection.
- **Live streaming** — the view subscribes to the run's Socket.IO room; node
  statuses, the timeline, and the log tail update as the worker executes,
  without polling.

The **runs list** (`/runs`) scales to large histories: filter by status,
workflow, trigger type, and date range; free-text search by workflow name or run
id; and cursor-based (keyset) infinite scroll. Each row offers quick actions —
open the detail view, replay, and for a failed run, jump straight to the failing
node.

Logs are persisted to a `RunLog` table and served by `GET /runs/:id/logs`
(supporting `?after=<seq>` for incremental fetches); the runs list is served by
the paginated, filtered `GET /runs`. Payloads stay lean — the list omits
per-node executions, and logs are fetched separately from the run record.

## Real-time collaboration

When more than one person opens the same workflow, the editor comes alive with
multi-user awareness — the kind you'd expect from a collaborative design tool.

- **Presence** — avatars of everyone else viewing the workflow appear in the top
  bar, each in a stable per-user color. A person with several tabs shows once.
- **Live cursors** — other people's cursors glide across the canvas, labeled with
  their name. Cursors are broadcast in *flow-space* coordinates, so they stay
  glued to canvas content even when collaborators have panned/zoomed differently,
  and are smoothly interpolated by a `requestAnimationFrame` loop (snapped, not
  animated, under `prefers-reduced-motion`).
- **Selection awareness** — nodes another person has selected are outlined in
  their color.
- **Edit soft-lock** — when someone has a node's config open, a non-blocking
  "X is editing" hint shows on the canvas and in the inspector, so two people
  don't silently clobber each other.

### How it works

Presence is **ephemeral** — it lives entirely in Socket.IO room state and is
never persisted. Each open editor tab is one socket that joins a workflow-scoped
room (`wf:<id>`), authorized against the same workspace membership as the REST
API. Cursors, selection, editing state, and applied graph edits are broadcast to
the room and fanned out across API processes by the existing Redis adapter.
Join/leave, reconnect (the client re-joins and replays its state on a fresh
socket id), and stale-cursor cleanup are all handled.

Graph edits (move/add/remove nodes and edges) are broadcast as small ops and
merged **last-write-wins** — positions simply overwrite — which keeps the merge
simple and robust for the common case of people working in different areas of
the canvas.

**Future work:** true conflict-free concurrent co-editing (e.g. a CRDT such as
Yjs over the document) is a stretch goal. Today's last-write-wins merge can drop
a change if two people edit the *same* node at the same instant; the soft-lock
makes that visible but doesn't prevent it. A CRDT would make concurrent edits to
the same node converge without loss.

## Credential encryption key management

Workflow credentials (API keys, SMTP passwords, webhook URLs, DB connection
strings) are encrypted at rest with **AES-256-GCM** before they touch the
database. The `Credential.encryptedData` column holds a self-describing packed
string — `v1:<iv>:<authTag>:<ciphertext>` (each part base64) — and the plaintext
is decrypted **only on the worker, at execution time, scoped to the run's
workspace**. Secrets are never returned to the client: the API exposes only
metadata (name, type, non-secret fields, and an optional `last4` preview).

### The master key

The encryption key comes from the **`CREDENTIALS_KEY`** environment variable. It
must decode (base64, or a 64-character hex string) to exactly **32 bytes**. The
key is loaded and validated once at startup, so a malformed key fails fast.

Generate a fresh key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# or
openssl rand -base64 32
```

Set it in `server/.env` (see `server/.env.example`). A fixed dev-only fallback
lets a fresh checkout boot without configuration, but **production must set its
own `CREDENTIALS_KEY`**, supplied via your platform's secret manager and never
committed.

### Rotation & operational notes

- **Rotation:** the key is not stored with the data, so changing
  `CREDENTIALS_KEY` makes all existing credentials undecryptable. To rotate,
  decrypt with the old key and re-encrypt with the new one before swapping it
  (the `v1:` version prefix leaves room for an envelope/rotation scheme later).
- **Loss:** if the key is lost, stored credentials cannot be recovered — users
  must re-enter them.
- **Blast radius:** the key decrypts every workspace's secrets, so treat it as a
  top-tier secret (KMS/secret manager, restricted access, audit logging).

## Testing & CI

```bash
npm run lint        # both workspaces
npm run typecheck    # both workspaces
npm run test:server  # server, needs Postgres (+ Redis for the queue integration test)
npm run test:web     # web
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on every
push and pull request, with real Postgres and Redis service containers — the
same setup as local dev, not mocks — and a production **web build** to catch
bundling regressions the jsdom unit tests can't.

## Deployment

Fluxion deploys to [Railway](https://railway.app) as **five services** in one
project — they map directly to the local topology:

| Service | Source | Notes |
| --- | --- | --- |
| **Postgres** | Railway plugin | `DATABASE_URL` is injected into api + worker |
| **Redis** | Railway plugin | `REDIS_URL` is injected into api + worker |
| **api** | `Dockerfile.server` (default CMD) | Express + Socket.IO on `:4000` |
| **worker** | `Dockerfile.server`, start command `node server/dist/worker.js` | shares the api image so they're always in sync |
| **web** | `Dockerfile.web` | static SPA; `VITE_API_URL` is a **build arg** baked into the bundle |

Key configuration:

- Set the server env vars from [`server/.env.example`](server/.env.example) on
  **api** and **worker** — most importantly a strong `JWT_SECRET`, a real
  32-byte `CREDENTIALS_KEY` (never the dev fallback), and `CLIENT_URL` set to the
  web service's URL (for CORS + the Socket.IO origin).
- On **web**, set `VITE_API_URL` as a *Build Variable* (Vite inlines `VITE_*` at
  build time) pointing at the api service's public URL.
- Migrations: run `npx prisma migrate deploy --workspace=server` against the
  production `DATABASE_URL` on each release (e.g. as a Railway release command).

> [!IMPORTANT]
> **Cost implications (re-flagged for v3).** The topology is unchanged — still
> **five always-on services** (two Node processes + Postgres + Redis + a static
> server) — which exceeds Railway's free trial credit. Postgres and Redis are
> billed for uptime + storage, and the api/worker run continuously to keep the
> queue and realtime layer live. v3 adds more tables and, notably, stores user
> **avatars as small data-URL strings in Postgres** (no object store) — a modest,
> bounded bump to row size and DB storage, not a new service. Expect a small
> monthly bill on the Hobby plan; scale the worker to zero (or merge api+worker)
> to reduce idle cost. Treat `CREDENTIALS_KEY`/`JWT_SECRET` as production secrets
> via Railway's secret store.
>
> **Redeploy checklist (v3).** Push to `main`, let each service rebuild, and run
> `npx prisma migrate deploy --workspace=server` against the production
> `DATABASE_URL` so the new migrations (workspace templates, user profile columns,
> and the rest of v3/v3.5) apply before traffic hits the new code.

**Live URL:** _not yet wired — populate here and in the web service's
`VITE_API_URL` once the project is deployed._ No source change is needed: the app
reads `VITE_API_URL` (REST + Socket.IO base) with a `localhost:4000` fallback for
local dev, so wiring the URL is purely a deploy-time build variable.
