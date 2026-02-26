# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Octree is an AI-powered LaTeX editor built with Next.js 15 (App Router), React 19, Supabase, and Stripe. Users create projects containing LaTeX files, edit them with AI assistance (via Claude Agent SDK), compile to PDF, and generate documents from chat conversations.

## Commands

```bash
npm run dev          # Start dev server with Turbopack
npm run build        # Production build (runs create-dummy-cli.js first)
npm run lint         # ESLint
npm run test         # Run all tests (vitest)
npm run test:watch   # Watch mode
vitest run @__tests__/unit/use-edit-suggestions.single-edit.test.ts  # Single test file
```

The `claude_server/` is a separate Node.js project (Express + Claude Agent SDK) with its own package.json:
```bash
cd claude_server && npm run dev   # Local agent server with hot reload (port 8787)
```

## Architecture

### Two-Service Design

1. **Next.js App** (Vercel) — the main web application
2. **Claude Server** (`claude_server/`) — standalone Express server running Claude Agent SDK on a DigitalOcean VPS, avoiding serverless timeout limits. The Next.js app calls it via `CLAUDE_AGENT_SERVICE_URL`. Responses stream as SSE events.

### Database Layer — Client vs Server Pattern

This is the most important architectural pattern to follow:

- **Client-side** (`lib/requests/`): Uses `createClient()` from `@/lib/supabase/client`. Called from `'use client'` components. Auth via `getSession()`.
- **Server-side** (`actions/`): Uses `'use server'` directive. Uses `await createClient()` from `@/lib/supabase/server`. Auth via `getUser()`. Can use `revalidatePath`/`redirect`.

Never mix these — don't call `lib/requests` from server components or `actions` from client components.

### State Management

- **Zustand stores** (`stores/`): Global client state — `project.ts`, `file.ts`, `file-tree.ts`, `generate.ts`, `editor-theme.ts`. Stores follow a pattern of exported hooks (`useProject`, `useSelectedFile`) and an `Actions` object (`ProjectActions`, `FileActions`) for mutations.
- **React Context** (`app/context/project.tsx`): `ProjectProvider` wraps the app for project refresh triggers.
- **SWR/fetch**: Used in some API data fetching patterns.

### Key Directories

- `app/projects/[projectId]/` — Main editor workspace (layout loads project, files, subscription)
- `app/generate/` — AI document generation from chat
- `app/api/` — API routes: `compile-pdf`, `octra-agent`, `generate-document`, `import-latex`, Stripe webhooks, etc.
- `lib/octra-agent/` — In-app agent utilities (SSE streaming, line edits)
- `claude_server/lib/octra-agent/` — Standalone copy of agent library for the Express server (tools, intent inference, AST edits)
- `hooks/` — Custom React hooks, notably `use-editor-*.ts` for Monaco editor integration and `use-edit-suggestions.ts` for AI edit flow
- `components/editor/` — Monaco-based LaTeX editor components
- `types/` — TypeScript types (`project.ts`, `document.ts`, `compilation.ts`, `edit.ts`, `conversation.ts`)
- `database.types.ts` — Auto-generated Supabase types. Import as `import type { Database, Tables } from '@/database.types'`
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
- **project_collaborators** — id, project_id, user_id, role, invited_by, created_at
- **project_invitations** — id, project_id, email, token, role, invited_by, created_at, expires_at, accepted_at
- **project_zotero_sources** — project_id, source_url, owner_type, owner_id, collection_key, last_synced_at, last_sync_status, last_sync_error, entries (jsonb), refs_bib, created_at, updated_at
- **user_usage** — id, user_id, edit_count, is_pro, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_start/end, cancel_at_period_end, monthly_edit_count, monthly_reset_date, daily_edit_count, daily_reset_date, referral_source, onboarding_completed, role
- **user_walkthroughs** — user_id, dashboard_seen, dashboard_seen_at, generated_first_at, generate_seen, generate_seen_at, editor_seen, editor_seen_at, created_at

Legacy/unused tables (do not use):
- **documents** — superseded; not referenced in app code
- **document_versions** — superseded; not referenced in app code

### Testing

Tests live in `@__tests__/` with subdirectories: `unit/`, `integration/`, `e2e/`. Setup file at `@__tests__/setup.ts`. Vitest with jsdom environment. Path alias `@/` resolves to project root.

## Conventions

- TypeScript strict mode. Functional components only, named exports preferred.
- `'use client'` directive required for client components; `'use server'` for server actions.
- Import order: React/Next.js → third-party → internal (`@/` alias).
- ESLint extends `next/core-web-vitals` and `next/typescript`. Unused vars, `no-explicit-any`, and `ban-ts-comment` rules are disabled.
- Do not create `.md` files unless explicitly requested.
