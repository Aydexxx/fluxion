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
`node:started`, `node:finished`, `run:finished`) over **Socket.IO**, scoped to
a per-run room and fanned out across processes via a Redis adapter. The editor
subscribes to its active run's room and updates each node's status pill on
the canvas in real time — no polling.

Workflows can also start from an inbound **webhook** (an unguessable
per-workflow URL) or a **cron schedule** (BullMQ job schedulers reconciled
against each workflow's `trigger.schedule` nodes), in addition to a manual
*Run* click.

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
  - *AI:* a single LLM call, and a multi-step tool-using agent
  - *Logic:* condition (branching), loop/iterate, filter
  - *Output:* response
- **Execution engine** — topological DAG execution, `{{template}}`
  interpolation across trigger payload + upstream outputs, per-node timeouts,
  and full run/node-execution history for replay and debugging.
- **Queue + worker** — BullMQ-backed retries with exponential backoff,
  dead-lettering after exhausted attempts, idempotent job processing, and
  independently scalable worker concurrency.
- **Live run status** — Socket.IO push updates so the canvas reflects a run's
  progress node-by-node as it happens.
- **Encrypted credential vault** — see below.
- **Workspaces, auth & roles** — JWT auth, multi-user workspaces with
  owner/admin/member roles.
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
same setup as local dev, not mocks.
