# Molly & Stitch — Support Console

A single-operator customer-support console for the e-commerce brand **Molly & Stitch**. It ingests the brand's Gmail support inbox, lets the operator browse threads and full message history, and (in later phases) AI-drafts replies that a human approves before anything is sent.

> **An email is sent only as the direct result of a human approving a specific draft.** Phase 0 (this build) contains **no send path and no AI** — it is read-only ingestion + inbox + thread review.

## Status — Phase 0

Implemented: monorepo, Postgres schema (Drizzle), Gmail OAuth (read-only), idempotent ingestion (6-month backfill + incremental History-API sync), single-operator auth, and the Inbox + Thread Review screens wired to real Gmail data. Later phases (triage, knowledge base, AI drafting + guarded send, Shopify, trust instrumentation) are scoped in `molly-and-stitch-build-spec.md`.

## Architecture

pnpm workspaces monorepo, TypeScript strict throughout:

```
apps/
  api/      Fastify API — session auth, threads, sync trigger, Gmail OAuth callback
  web/      React + Vite frontend implementing the design
  worker/   Ingestion worker — scheduled / one-shot Gmail sync
packages/
  db/           Drizzle schema, migrations, client, seed
  shared/       Shared types, enums, category & sender-rule definitions
  integrations/ Token crypto (AES-256-GCM), Gmail OAuth, ingestion engine (server-only)
```

The `packages/db` Drizzle schema is the single source of truth for the data model. The one ingestion code path lives in `packages/integrations` and is shared by the API's manual `POST /sync` and the worker's scheduled run — it is idempotent and never sends email.

## Prerequisites

- **Node ≥ 20** (developed on Node 23). `corepack enable` activates pnpm (no global install needed).
- A **Postgres** database. This project targets **Railway-hosted Postgres** for both local dev and production — set `DATABASE_URL` to the Railway connection string.
- A **Google Cloud OAuth client** for the Gmail API (walkthrough below).

## Local setup

```bash
corepack enable                 # activates the pinned pnpm
pnpm install
cp .env.example .env            # then fill in the values (see below)

pnpm db:migrate                 # apply the schema to your Railway Postgres
pnpm db:seed                    # categories, sender rules, operator account
pnpm db:enable-vector           # optional now; required in Phase 2 (pgvector)

pnpm dev                        # runs api + web + worker together
```

- API: http://localhost:4000
- Web: http://localhost:5173

Log in with the `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` you set in `.env`. Then go to **Settings → Connect Gmail** to authorize, and hit **Sync** (top bar) to pull your inbox.

### Generating secrets

```bash
openssl rand -hex 32   # use for SESSION_SECRET
openssl rand -hex 32   # use for ENCRYPTION_KEY (must be 32 bytes = 64 hex chars)
```

## Google Cloud — Gmail OAuth setup

The console reads Gmail with the **`gmail.readonly`** scope only (send/modify scopes are added in Phase 3).

1. Go to <https://console.cloud.google.com/> → create a project (e.g. "MS Support Console").
2. **APIs & Services → Library →** enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen:**
   - User type: **External**.
   - Fill in app name, your support email.
   - **Scopes:** add `.../auth/gmail.readonly`.
   - **Test users:** add `contact@mollyandstitch.us` (and your own address). While the app is in "Testing", only listed test users can authorize — that's fine for a single operator.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add
     - `http://localhost:4000/auth/google/callback` (local)
     - `https://<your-api-domain>/auth/google/callback` (Railway, added at deploy)
5. Copy the **Client ID** and **Client secret** into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

The refresh token is obtained through the in-app consent flow and stored **encrypted** in the `connections` table — it is never written to `.env` or committed.

## Environment variables

See `.env.example` for the full annotated list. Phase 0 uses:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Railway Postgres connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail OAuth client |
| `GOOGLE_REDIRECT_URI` | OAuth callback (defaults to `${APP_BASE_URL}/auth/google/callback`) |
| `GMAIL_ACCOUNT` | Mailbox label (default `contact@mollyandstitch.us`) |
| `SESSION_SECRET` | Server-side session signing |
| `ENCRYPTION_KEY` | AES-256 key (64 hex chars) for OAuth tokens at rest |
| `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` | Seeds the single operator login |
| `APP_BASE_URL` / `WEB_BASE_URL` | API and web origins (CORS + redirects) |
| `BACKFILL_MONTHS` | Backfill window (default 6) |
| `SYNC_INTERVAL_MINUTES` | Worker poll interval (default 5) |

`ANTHROPIC_API_KEY`, `EMBEDDINGS_API_KEY`, and the Shopify vars are listed but **unused in Phase 0**.

## Useful commands

```bash
pnpm dev                  # api + web + worker
pnpm typecheck            # strict typecheck across all packages
pnpm db:generate          # regenerate a migration after editing the schema
pnpm db:migrate           # apply migrations
pnpm db:seed              # idempotent seed
pnpm --filter @ms/worker sync:once   # run one ingestion pass and exit
```

## Ingestion behavior

- **First run** (no stored `last_history_id`): backfills the last `BACKFILL_MONTHS` months via `messages.list?q=after:…`, then records the mailbox `historyId`.
- **Subsequent runs:** incremental via the Gmail **History API** from the stored `last_history_id`. If that id has expired (404), it safely falls back to a backfill.
- **Idempotent:** threads and messages are keyed on Gmail thread/message ids and upserted on conflict. Running sync repeatedly never duplicates rows and never sends email.

## Deploying to Railway

Phase 0 deploys as a **single combined service** on Railway: the root `railway.json` builds the web UI and the API serves it (same origin) while running ingestion on an interval. This is the fastest path and keeps auth simple; the app is structured so it can later be split into the spec's separate `api` / `web` / `worker` services (each app still has its own start scripts).

**How the combined service is configured** (root `railway.json`):
- Build: `pnpm --filter @ms/web build` → produces `apps/web/dist`.
- Start: `pnpm db:migrate && pnpm db:seed && pnpm --filter @ms/api start` (migrate + seed are idempotent, so they run safely on every deploy).
- The API serves `apps/web/dist` for all non-API GET routes, and runs the ingestion scheduler when `NODE_ENV=production` / `RAILWAY_ENVIRONMENT` is set.

**Database:** the project uses the **pgvector** service (image `pgvector/pgvector:pg18`, extension enabled) — not the stock `Postgres` plugin. The app's `DATABASE_URL` references it over the private network: `${{ pgvector.DATABASE_URL_PRIVATE }}`.

**Service variables** (set on the app service via `railway variable set … --service Support-Console`):

| Var | Value |
|---|---|
| `DATABASE_URL` | `${{ pgvector.DATABASE_URL_PRIVATE }}` |
| `PORT` | `8080` (matches the generated domain's target port) |
| `NODE_ENV` | `production` |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | `openssl rand -hex 32` each |
| `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` | console login |
| `APP_BASE_URL`, `WEB_BASE_URL` | the service's public URL (same value) |
| `GOOGLE_REDIRECT_URI` | `<public-url>/auth/google/callback` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud (added when Gmail OAuth is set up) |
| `GMAIL_ACCOUNT` | `contact@mollyandstitch.us` |
| `BACKFILL_MONTHS`, `SYNC_INTERVAL_MINUTES` | `6`, `5` |

`VITE_API_URL` is left **unset** in production so the web build uses same-origin relative URLs. Local dev sets it to `http://localhost:4000` via `apps/web/.env.development`.

### pgvector

Enabled (v0.8.3) on the `pgvector` database. Verify any time with:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

A row means pgvector is ready for Phase 2.

## Phase 0 definition of done

The operator can log in, connect Gmail (read-only), and browse the real support inbox — threads and full message history — with ingestion running idempotently on a schedule, locally and on Railway. Then: stop for review before Phase 1.
