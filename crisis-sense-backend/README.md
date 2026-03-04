# Crisis-Sense Backend

Production-oriented backend for asynchronous crisis report analysis.

## What It Does

- Accepts reports through REST API.
- Processes reports asynchronously in a worker.
- Builds embeddings and retrieves context from Supabase (`pgvector` + RPC).
- Runs Claude analysis and stores strict JSON results.
- Exposes protected dashboard APIs for report status and analysis retrieval.

## Services

- API service: `src/server.ts`
- Worker service: `src/workers/reportProcessor.ts`

## Required Runtime Environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred; `SUPABASE_SERVICE_KEY` is still accepted for compatibility)
- `ANTHROPIC_API_KEY`
- `INTERNAL_DASHBOARD_API_KEY`
- `PORT`

Copy `.env.example` to `.env` for local runs.

## Smoke Test

Run while API and worker are up:

- `npm run test:smoke`

Required test env vars:

- `INTERNAL_DASHBOARD_API_KEY`
- `SMOKE_USER_ID`
