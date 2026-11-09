# ADR-0011 — Deploy: API on Render, web on Vercel, under antonvolt.com

Status: accepted · 2026-11-09

## Context

`infra/` planned Fly for the API and Vercel for the web app; neither was deployed. The owner has Vercel (the project is on the Hobby team), Render and Supabase accounts, and owns `antonvolt.com` (registrar and DNS on Cloudflare).

The API cannot run serverless. The scheduler worker is a task started in the FastAPI lifespan, the store is one SQLite file, and the sidebar holds an SSE stream open. It needs one long-lived process with a persistent disk.

## Decision

- **API on Render**, one Starter instance with a 1 GB disk at `/data` (`render.yaml`, built from `infra/api.Dockerfile`). Free instances sleep and have no disk, so they would cold-start in front of a reviewer and lose the database. The lifespan seeds an empty database, so there is no seed step.
- **Web on Vercel**, project root `apps/web` (where `vercel.json` now lives; Vercel reads it only from the project root). `VITE_API_BASE` is set in the Vercel project and is baked in at build time.
- **Supabase is not used.** Moving the document store to Postgres JSONB is the production path (ADR-0003), not something the demo needs.
- **Domains:** `rcm-ai.antonvolt.com` (Vercel) and `rcm-ai-api.antonvolt.com` (Render), both CNAMEs on Cloudflare set to DNS only. Cloudflare's proxy would sit in front of the providers' own TLS and can buffer the SSE stream. CORS allows only `https://rcm-ai.antonvolt.com` (`TORCH_CORS_ORIGINS`).
- **Shared state** is accepted: every visitor sees one world. "Reset demo to Wed 10:40" (`POST /clock/reset`) restores the seed.
- `infra/fly.toml` is removed so there is one deploy path.

## Consequences

Deploy is `git push origin main`; both services build from it. Web and API deploy separately, so ADR-0005's note applies: an additive API field reaches the web only after the web rebuilds, and strict REST schemas would show it as `schema_mismatch` in between. Deploy the API first, then the web, for schema changes. Vercel preview URLs are not in the CORS list, so previews cannot call the API.
