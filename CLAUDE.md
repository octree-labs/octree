# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Octree is an AI-powered LaTeX editor built with Next.js 15 (App Router), React 19, Supabase, and Stripe. Users create projects containing LaTeX files, edit them with AI assistance (via the agent server), compile to PDF, and generate documents from chat conversations.

## Monorepo Layout

pnpm workspaces + Turborepo. Each app has its own `package.json`; tooling shared across the repo (Prettier, Supabase CLI, Turbo) lives in the root `package.json`.

- `apps/web/` — Next.js app (`@octree/web`)
- `apps/agent/` — Agent server (`@octree/agent`)
- `apps/compile/` — LaTeX compile service in Go (`@octree/compile`; its `package.json` only wraps `go run`/`go build`/`go test` for Turbo)
- `packages/agent-protocol/` — Types-only package with the web ↔ agent wire contract (`StringEdit`, `ProjectFileContext`, `AgentRequest`)
- `supabase/` — Local Supabase config and migrations (stays at the root; the CLI runs from here)

## Commands

Run from the repo root:

```bash
pnpm dev                          # supabase start, then all apps in dev mode via turbo
pnpm build                        # Build all apps (turbo-cached)
pnpm lint                         # ESLint (web)
pnpm test                         # Vitest (web) + go test (compile)
pnpm dev --filter=@octree/web     # Any task, one app
pnpm --filter @octree/web test:watch                                                            # Vitest watch mode
pnpm --filter @octree/web exec vitest run @__tests__/unit/use-edit-suggestions.single-edit.test.ts  # Single test file
```

Add dependencies to the app that uses them: `pnpm --filter @octree/web add <pkg>`. pnpm is strict — a package must be declared in the importing app's `package.json`, even if another app already depends on it. Dependency install scripts must be allowed in `allowBuilds` in `pnpm-workspace.yaml`, which also holds the workspace-wide `overrides`.

## Architecture

### Three-Service Design

1. **Web app** (`apps/web`, Vercel) — the main web application.
2. **Agent server** (`apps/agent`) — standalone Express server running the Vercel AI SDK (`streamText` + `@ai-sdk/anthropic`) in Docker on a DigitalOcean droplet, avoiding serverless timeout limits. The web app calls it via `CLAUDE_AGENT_SERVICE_URL`; requests are authenticated with the Supabase JWT. Responses stream as SSE events. Deploy with `apps/agent/scripts/deploy.sh`, which builds from `turbo prune @octree/agent --docker` output.
3. **Compile service** (`apps/compile`) — Go service running `latexmk` (TeX Live) in Docker. The web app calls it via `COMPILE_SERVICE_URL` (server relay in `app/api/compile-pdf/`) and `NEXT_PUBLIC_COMPILE_SERVICE_URL` (browser, incl. SyncTeX). Deploy with `apps/compile/deploy/deploy.sh` (host from `DEPLOY_HOST` in `apps/compile/.env`); deploys never sync `.env` — the production one, with `SUPABASE_JWT_SECRET`, lives only on the server, and the local one is a dev config with auth disabled. This repo is public: keep server IPs and other infrastructure details in gitignored `.env` files, not in code.

When changing the request body or edit shape between web and agent, update `packages/agent-protocol` — both apps type-check against it. Import it with `import type` only; it has no runtime code and isn't installed in the agent's Docker image.

### Database Layer — Client vs Server Pattern

This is the most important architectural pattern to follow (paths relative to `apps/web/`):

- **Client-side** (`lib/requests/`): Uses `createClient()` from `@/lib/supabase/client`. Called from `'use client'` components. Auth via `getSession()`.
- **Server-side** (`actions/`): Uses `'use server'` directive. Uses `await createClient()` from `@/lib/supabase/server`. Auth via `getUser()`. Can use `revalidatePath`/`redirect`.

Never mix these — don't call `lib/requests` from server components or `actions` from client components.

### State Management

- **Zustand stores** (`stores/`): Global client state — `project.ts`, `file.ts`, `file-tree.ts`, `generate.ts`, `editor-theme.ts`. Stores follow a pattern of exported hooks (`useProject`, `useSelectedFile`) and an `Actions` object (`ProjectActions`, `FileActions`) for mutations.
- **React Context** (`app/context/project.tsx`): `ProjectProvider` wraps the app for project refresh triggers.
- **SWR/fetch**: Used in some API data fetching patterns.

### Key Directories

Web app paths are relative to `apps/web/`:

- `app/projects/[projectId]/` — Main editor workspace (layout loads project, files, subscription)
- `app/generate/` — AI document generation from chat
- `app/api/` — API routes: `compile-pdf`, `octra-agent`, `generate-document`, `import-latex`, Stripe webhooks, etc.
- `lib/octra-agent/` — In-app agent utilities (SSE streaming)
- `hooks/` — Custom React hooks, notably `use-editor-*.ts` for Monaco editor integration and `use-edit-suggestions.ts` for AI edit flow
- `components/editor/` — Monaco-based LaTeX editor components
- `types/` — TypeScript types (`project.ts`, `document.ts`, `compilation.ts`, `edit.ts`, `conversation.ts`)
- `database.types.ts` — Auto-generated Supabase types. Import as `import type { Database, Tables } from '@/database.types'`

Elsewhere:

- `apps/agent/lib/` — Agent library for the Express server (tools, intent inference, content processing, session memory)
- `apps/compile/internal/` — Compile service internals (compiler queue, SyncTeX, handlers)
- `supabase/migrations/` — Database migrations

### UI Stack

- **shadcn/ui** components in `components/ui/` with Radix UI primitives
- **Tailwind CSS** for styling; use `cn()` from `@/lib/utils` for conditional classes
- **class-variance-authority** for component variants
- **Monaco Editor** (`@monaco-editor/react`) for the LaTeX code editor
- **Sonner** for toast notifications (`toast.success()`, `toast.error()`)
- **Satoshi** custom font (local, variable weight)

### Database Schema (Supabase)

Active tables:
- **projects** — id, user_id (→ auth.users), title, created_at, updated_at
- **files** — id, project_id (→ projects), name, type, size, uploaded_at, url
- **generated_documents** — id, user_id, title, prompt, latex, status, error, created_at, attachments (jsonb), conversation_summary (jsonb), last_user_prompt, last_assistant_response, interaction_count, message_history (jsonb)
- **drafts** — id, title, content, source, created_at
- **email_suppressions** — email, created_at
- **project_zotero_sources** — project_id, source_url, owner_type, owner_id, collection_key, last_synced_at, last_sync_status, last_sync_error, entries (jsonb), refs_bib, created_at, updated_at
- **user_usage** — id, user_id, edit_count, is_pro, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_start/end, cancel_at_period_end, monthly_edit_count, monthly_reset_date, daily_edit_count, daily_reset_date, referral_source, onboarding_completed, role
- **user_walkthroughs** — user_id, dashboard_seen, dashboard_seen_at, generated_first_at, generate_seen, generate_seen_at, editor_seen, editor_seen_at, created_at

The full schema is `supabase/migrations/20250101000000_baseline.sql` (dumped from prod); new changes go in migrations after it.

### Testing

Web tests live in `apps/web/@__tests__/` with subdirectories: `unit/`, `integration/`, `e2e/`. Setup file at `apps/web/@__tests__/setup.ts`. Vitest with jsdom environment. Path alias `@/` resolves to `apps/web/`. Compile service tests are Go tests next to the code in `apps/compile/internal/`.

## Conventions

- TypeScript strict mode. Functional components only, named exports preferred.
- `'use client'` directive required for client components; `'use server'` for server actions.
- Import order: React/Next.js → third-party → internal (`@/` alias).
- ESLint extends `next/core-web-vitals` and `next/typescript`. Unused vars, `no-explicit-any`, and `ban-ts-comment` rules are disabled.
- Do not create `.md` files unless explicitly requested.
