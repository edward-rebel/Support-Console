# Build Specification — Molly & Stitch Customer Support Automation Platform

**Audience:** Claude Code. This is the founding document for the project. Read it fully before writing any code. Build incrementally per the phase plan at the end — **build Phase 0 completely and stop for human review before starting Phase 1.** Do not scaffold all phases at once.

---

## 1. Project overview

A custom, single-operator customer support automation platform for the e-commerce brand **Molly & Stitch**. It connects to the brand's Gmail support inbox (`contact@mollyandstitch.us`, on Google Workspace) and its Shopify store. Incoming email is triaged (is this a real customer request?), classified by type, and answered with an AI-drafted reply grounded in the brand's real historical answers and tone. A human reviews every draft in a custom web console and approves, edits, or rejects it. **An email is sent only as the direct result of a human approving a specific draft.**

The owner is building this solo with AI assistance, partly to learn how to build a platform like this. Favor clear, conventional, well-documented patterns over cleverness.

A high-fidelity UI design already exists (produced separately) and should be implemented as the front end. Where this spec and the design disagree on data or behavior, this spec wins; where they disagree on visuals, the design wins.

---

## 2. Goals and non-goals (v1)

**In scope for v1:**
- Gmail ingestion: backfill the last 6 months + ongoing incremental sync.
- A triage gate that separates genuine customer support requests from noise (TikTok/Meta/vendor/marketing email).
- Classification into: Exchange, Shipping Status, Sizing, Discount, Other.
- A knowledge base mined from historical threads (canonical answers, policies, example Q&A pairs, tone profile), used for retrieval (RAG).
- AI-drafted replies surfaced in a review console.
- Human review → approve/edit/reject. App sends approved replies via the Gmail API.
- **Read-only** Shopify integration: fetch order/customer data; recommend changes as text for the human to execute manually.
- Per-category performance metrics and a full audit log of sends.

**Explicitly out of scope for v1 (do not build):**
- Multi-user accounts or roles (single operator only).
- Any Shopify write operations (no refunds, cancellations, address edits, discount creation).
- Any auto-send or batch-send. No "approve all."
- Real-time Gmail push (Pub/Sub). Use polling — volume is ~200 emails/month.
- Fine-tuning. RAG only.

---

## 3. Non-negotiable invariants

These are hard rules. Encode them structurally so they cannot be violated by accident.

1. **Human-approval send invariant.** There must be exactly one code path that sends email, and it must require (a) a specific `draft` in an approved state and (b) an explicit authenticated user action that references that draft id. There must be no loop, scheduler, batch endpoint, or background job that can send email. No "send all."
2. **Shopify is read-only.** Request only read scopes. There must be no Shopify write/mutation call anywhere in the codebase. "Recommended actions" are plain text/data attached to a draft for the human to act on manually.
3. **Idempotent ingestion.** Re-running sync (full or incremental) must never duplicate messages/threads and must never trigger a send. Use Gmail message IDs and thread IDs as natural keys; upsert on conflict.
4. **Preserve raw data.** Store the raw body (text and HTML) and raw metadata of every email permanently. Every AI step (triage, classify, draft, knowledge extraction) must be re-runnable from stored raw data without re-fetching from Gmail.
5. **Correct threading on send.** Replies must go out on the original Gmail thread with proper `In-Reply-To` and `References` headers and the correct thread id, from `contact@mollyandstitch.us`.
6. **Spend discipline.** The triage gate filters by deterministic sender rules before any LLM call. Only ambiguous email reaches the model. Never run the expensive drafting model on non-customer email.
7. **Secrets.** All credentials/tokens via environment variables or the database (encrypted at rest where feasible). Never commit secrets. Provide `.env.example`.

---

## 4. Tech stack

Decisive choices (each swappable, but build with these unless told otherwise):

- **Language:** TypeScript everywhere, `strict` mode on.
- **Repo:** single monorepo, pnpm workspaces.
- **Backend API:** Node + **Fastify**. (Express is an acceptable alternative if a dependency forces it; prefer Fastify.)
- **Worker:** a separate Node process in the same repo for ingestion + scheduled sync (Railway cron or an internal scheduler).
- **Frontend:** **React + Vite + TypeScript**, implementing the existing design. Calls the API.
- **Database:** **Postgres + pgvector** (single datastore; do not add a separate vector DB).
- **ORM / migrations:** **Drizzle ORM**. Chosen for type-safety, first-class pgvector support, and SQL transparency (good for learning). (Prisma is the alternative if preferred, but Drizzle pairs better with pgvector here.)
- **Reasoning model:** Anthropic API via `@anthropic-ai/sdk`. Use a cheap model for triage/classification and a stronger model for drafting (e.g. a Haiku-tier model for triage, a Sonnet-tier model for drafting). **Confirm current model IDs against Anthropic's docs at build time** rather than hardcoding from memory; centralize model IDs in one config file.
- **Embeddings:** a **separate provider** — Anthropic does not offer a first-party embeddings model. Plan on **Voyage AI**. **Verify the current recommended embeddings provider and model against Anthropic's docs before implementing**, and put embeddings behind a small `EmbeddingProvider` interface so the provider is swappable with one file change.
- **Email:** Gmail API via `googleapis` (OAuth2).
- **Commerce:** Shopify Admin API (GraphQL preferred), read scopes only.
- **Auth (console):** single-operator email+password with server-side sessions. Keep it minimal — multi-user is out of scope.
- **Hosting:** Railway. Separate services for `api`, `web`, and `worker`, plus the managed Postgres plugin. Provide Railway config and start commands.

---

## 5. Repository structure

```
/apps
  /api          Fastify API server
  /web          React + Vite frontend (implements the design)
  /worker       ingestion + scheduled sync jobs
/packages
  /db           Drizzle schema, migrations, db client, seed scripts
  /shared       shared types, category definitions, enums, pure utils
.env.example
package.json    pnpm workspaces config
README.md       setup, env, run, deploy instructions
```

Shared types (thread/message/draft/category shapes) live in `/packages/shared` and are imported by api, web, and worker. The Drizzle schema in `/packages/db` is the single source of truth for the data model.

---

## 6. Environment variables

Provide `.env.example` documenting all of these:

- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `EMBEDDINGS_API_KEY` (e.g. Voyage)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (Gmail OAuth; the refresh token is obtained via the OAuth flow and stored encrypted in the DB, not in env)
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN` (added at Phase 4)
- `SESSION_SECRET`
- `ENCRYPTION_KEY` (for encrypting stored OAuth tokens at rest)
- `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` (used once to seed the single operator account)
- `APP_BASE_URL`, `WEB_BASE_URL`

---

## 7. Data model

Implement in Drizzle. Tables and key columns (add timestamps `created_at`/`updated_at` to all):

- **users** — `id`, `email`, `password_hash`. Single row in practice.
- **sync_state** — tracks Gmail incremental sync. `id`, `last_history_id`, `last_full_sync_at`, `last_incremental_sync_at`. Used to make polling incremental and idempotent.
- **sender_rules** — triage allow/block list. `id`, `pattern` (domain or full address), `rule` (`allow` | `block`), `note`. Seed with known noise domains (tiktok, meta/facebook, common marketing/vendor senders).
- **categories** — `id`, `name`, `color`, `is_active`. Seed: Exchange, Shipping Status, Sizing, Discount, Other.
- **threads** — one per Gmail thread. `id` (Gmail thread id, natural key), `subject`, `customer_email`, `customer_name`, `is_customer` (nullable boolean — triage result), `category_id` (nullable), `status` (`new` | `drafting` | `needs_review` | `sent` | `dismissed`), `confidence` (nullable), `last_message_at`. 
- **messages** — one per email. `id` (Gmail message id, natural key — enforces idempotency), `thread_id` (fk), `direction` (`inbound` | `outbound`), `from_address`, `to_address`, `subject`, `body_text`, `body_html`, `headers` (jsonb — keep `Message-ID`, `In-Reply-To`, `References` for threading), `gmail_internal_date`, `raw` (jsonb).
- **drafts** — AI-generated reply. `id`, `thread_id` (fk), `body`, `category_id`, `confidence`, `status` (`pending` | `approved` | `sent` | `dismissed` | `superseded`), `based_on` (jsonb — the knowledge entries/examples retrieved), `recommended_action` (nullable text/jsonb — the suggested Shopify change for the human), `model_id`, `prompt_version`.
- **sends** — audit log; one row per email actually sent. `id`, `draft_id` (fk), `thread_id` (fk), `sent_gmail_message_id`, `body_snapshot`, `approved_by_user_id`, `sent_at`. Immutable.
- **knowledge_entries** — RAG corpus. `id`, `type` (`canonical` | `example` | `policy`), `category_id` (nullable), `question` (nullable), `answer`, `source_thread_id` (nullable), `embedding` (vector), `is_active`. pgvector index on `embedding`.
- **tone_profile** — `id`, `content` (text/markdown describing brand voice), `version`. Single active row.
- **connections** — stored integration credentials. `id`, `provider` (`gmail` | `shopify`), `encrypted_tokens` (jsonb/bytea), `account_identifier`, `status`. Tokens encrypted at rest with `ENCRYPTION_KEY`.

---

## 8. System architecture

Five subsystems, plus the console:

1. **Ingestion (worker).** Gmail OAuth; one-time backfill (`after:` query for 6 months) and incremental sync via the Gmail History API using `sync_state.last_history_id`. Idempotent upserts into `threads`/`messages`. Runs on a schedule (every few minutes is ample).
2. **Triage gate.** Stage 1: deterministic `sender_rules` match → mark obvious noise as `is_customer = false` with no LLM call. Stage 2: cheap LLM classifies the ambiguous remainder for `is_customer` and `category`, writing back to the thread. Cheap before expensive, always.
3. **Knowledge layer (RAG).** Batch job over historical customer threads: extract question→answer pairs, cluster by category, distill canonical answers and policies, derive a tone profile. Embed entries into pgvector. Re-runnable from raw data. Retrieval = top-k vector search by category for an incoming email.
4. **Drafting agent.** For a classified customer email: retrieve relevant knowledge + tone profile, call the drafting model, produce a `draft` with `based_on` provenance and an optional `recommended_action`. (Phase 4: also call the read-only Shopify tool for order context.)
5. **Sending.** Single guarded path. Requires an approved draft + authenticated user action. Sends via Gmail API with correct threading. Writes an immutable `sends` row. Updates thread/draft status.

**Console (web + api):** inbox (with customer/noise separation + category/status), thread+draft review screen, approvals queue, knowledge base editor, insights (metrics + audit log + per-category auto-send toggles shown OFF/disabled), settings (connections, categories, sender rules).

---

## 9. Build phases

Build in order. **Stop for human review at the end of each phase.** Each phase must leave the app in a working, runnable state.

- **Phase 0 — Foundations + read-only inbox.** Repo, DB, Gmail OAuth, ingestion (backfill + incremental), minimal API (list threads, get thread+messages), single-operator auth, and the inbox + thread-detail screens from the design wired to real data. No AI. Railway deploy + README. *(Detailed task list below — start here.)*
- **Phase 1 — Triage gate.** Sender-rule pre-filter + cheap-model classification. Inbox separates customer vs noise and tags categories.
- **Phase 2 — Knowledge base.** Historical mining → canonical answers, policies, examples, tone profile → embeddings in pgvector. Knowledge Base editor screen.
- **Phase 3 — Drafting loop.** Retrieval + drafting model → draft in console → review/edit → **guarded send via Gmail API** → audit log. This completes the core product.
- **Phase 4 — Shopify (read-only).** One tool: fetch order status/tracking/line items/customer history by email. Drafts become order-aware; recommended actions surfaced as text.
- **Phase 5 — Trust instrumentation.** Confidence, per-category accept/edit rates, audit views, per-category auto-send toggles built but left OFF.

---

## 10. Phase 0 — concrete starting tasks

Do these now, in roughly this order:

1. Initialize the pnpm monorepo and the folder structure in §5. Set up TypeScript strict config shared across packages.
2. Provision Postgres; enable the `vector` extension. Set up Drizzle; implement the §7 schema for the tables needed now (`users`, `sync_state`, `sender_rules`, `categories`, `threads`, `messages`, `connections`) and generate the first migration. (Knowledge/draft/send tables can come in their phases, but you may define all tables now if cleaner.)
3. Seed `categories` and a starter `sender_rules` block/allow list. Seed the single operator from `OPERATOR_EMAIL`/`OPERATOR_PASSWORD`.
4. Implement Gmail OAuth2 (consent → store encrypted refresh token in `connections`). Use `gmail.readonly` scope for now; `gmail.send`/`gmail.modify` will be added at Phase 3.
5. Implement the ingestion worker: 6-month backfill via `messages.list` with an `after:` query, then incremental sync via the History API persisting `last_history_id`. Idempotent upserts keyed on Gmail message/thread ids. Parse and store text + html bodies and threading headers.
6. Build the minimal API: session auth; `GET /threads` (list, paginated, filterable later); `GET /threads/:id` (thread + messages).
7. Build the frontend inbox and thread-detail screens from the design, reading real data. No AI affordances yet beyond placeholders the later phases fill.
8. Railway: define `api`, `web`, `worker` services + Postgres; document start commands and the OAuth redirect URL. Write the README (local setup, env, migrate, seed, run, deploy).

**Phase 0 definition of done:** the operator can log in and browse their real support inbox — threads and full message history — in their own app, with ingestion running idempotently on a schedule. Then stop and request review.

---

## 11. Conventions

- TypeScript `strict`; shared types from `/packages/shared`; no `any` without justification.
- All DB access through Drizzle; migrations checked in; never hand-edit the DB in ways that diverge from migrations.
- Centralize model IDs, prompt templates, and the embeddings provider behind small modules/interfaces so they're swappable in one place. Version prompts (`prompt_version` on drafts).
- Idempotency and upserts for anything touching Gmail data.
- Structured logging; meaningful errors; never swallow send/auth errors.
- No secrets in the repo; `.env.example` kept current.
- Keep the send path isolated, small, and obviously auditable.

---

## 12. How to proceed

Confirm you've read this, then begin Phase 0 task 1. Make the technology choices in §4 unless you hit a concrete blocker, in which case surface it rather than silently substituting. Verify the embeddings provider and current Anthropic model IDs against live docs before relying on them. Build Phase 0 to its definition of done, ensure it runs, and stop for review before Phase 1.
