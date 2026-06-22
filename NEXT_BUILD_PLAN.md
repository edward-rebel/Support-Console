# Next Build Plan

## Current State

This repo is a working TypeScript monorepo for the Molly & Stitch Support Console.

Implemented:
- Single-operator auth with server-side sessions.
- Drizzle/Postgres schema for Phase 0 plus triage-ready fields.
- Gmail OAuth using the readonly scope.
- Encrypted Gmail token storage.
- Idempotent Gmail ingestion through backfill and incremental History API sync.
- Inbox, Review, Settings, sync status, sender-rule editing, and reclassification UI.
- Phase 1 triage code path using sender rules first, then Anthropic when configured.
- Railway combined-service deployment via `railway.json`.

Still placeholder:
- Approvals queue.
- Knowledge Base.
- Insights.
- Draft generation, edit/regenerate loop, guarded send, and audit log.
- Shopify read-only context rail.

## Access / Operations

GitHub is reachable through `origin` at `https://github.com/edward-rebel/Support-Console.git`.

Railway CLI is installed, but the local Railway auth token is expired. Run `railway login` again before inspecting project variables, pulling config, or deploying.

## Important Cleanup Before More Product Work

1. Reconcile docs and phase labels.
   - README still says Phase 0 has no AI, but triage/Anthropic code is already present.
   - Decide whether the project is now "Phase 1 in progress" or whether triage should stay dormant until explicitly enabled.

2. Decide Railway shape.
   - Current repo uses a single combined service in `railway.json`.
   - The original spec called for separate `api`, `web`, and `worker` services.
   - The repo's Railway skill expects `.railway/railway.ts` for infrastructure-as-code, but this repo does not have that file yet.

3. Add automated tests around invariants.
   - Sender-rule matching and precedence.
   - Gmail parse/body extraction.
   - Ingestion idempotency.
   - Triage rule behavior without an Anthropic key.
   - Future send invariant before any send code is written.

## Recommended Next Build

Finish and harden Phase 1 before starting the knowledge base.

Build order:
1. Add unit tests for `matchSenderRule`, HTML stripping, category assignment, and "no API key" triage behavior.
2. Add visible triage run/status controls in Settings or Inbox so the operator can run classification intentionally.
3. Add triage counts and pending-state affordances: customer, filtered out, unclassified.
4. Persist classification confidence separately from draft confidence, or rename the existing field before Phase 3 to avoid mixing concepts.
5. Update README and `.env.example` to describe Phase 1 honestly.
6. After Railway re-login, verify service variables and deployment health.

## Phase 2 Start Criteria

Start Knowledge Base only after:
- Phase 1 has test coverage.
- Triage can be run and monitored from the UI.
- Railway access is restored and current production variables are known.
- The docs match the deployed behavior.

Phase 2 first tasks:
1. Add `knowledge_entries` and `tone_profile` tables with pgvector support.
2. Create a re-runnable historical mining job from stored raw messages.
3. Add an embeddings provider interface.
4. Build the Knowledge Base screen from the design.
5. Add manual review/edit controls before knowledge entries influence drafting.
