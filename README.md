<p align="center">
  <img src="apps/web/app/icon.svg" alt="Octree Logo" width="100" />
</p>

<h1 align="center">Octree</h1>

<p align="center"><strong>AI-Powered LaTeX Editor</strong></p>

<p align="center">
Write, edit, and compile LaTeX with AI assistance. Chat with Claude to generate documents,<br/>
get intelligent edit suggestions, and collaborate in real time.
</p>

<p align="center">
  <a href="https://useoctree.com">Website</a> &bull;
  <a href="#getting-started">Quick Start</a> &bull;
  <a href="https://github.com/octree-labs/octree">GitHub</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/framework-Next.js_15-black" alt="framework" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6" alt="language" />
  <img src="https://img.shields.io/badge/database-Supabase-3ECF8E" alt="database" />
  <img src="https://img.shields.io/badge/AI-Vercel_AI_SDK-000000" alt="AI" />
  <img src="https://img.shields.io/badge/license-LGPL--3.0-blue" alt="license" />
</p>

## What is Octree?

Octree is an AI-powered LaTeX editor that brings intelligent writing assistance to academic and technical document creation. Write LaTeX in a Monaco-based editor, chat with Claude for help, and compile to PDF — all in one place.

## Getting Started

### Repository layout

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turborepo.com) monorepo:

| Path | What it is |
|------|------------|
| `apps/web` | Next.js app (deployed on Vercel) |
| `apps/agent` | AI editing agent — Express + Vercel AI SDK (Docker) |
| `apps/compile` | LaTeX compile service — Go + TeX Live (Docker) |
| `packages/agent-protocol` | Shared types for the web ↔ agent contract |
| `supabase/` | Local Supabase config and migrations |

### Prerequisites

- Node.js 22+ and pnpm (`corepack enable` installs the version pinned in `package.json`)
- [Docker](https://docs.docker.com/get-docker/) for the local Supabase stack, or a hosted [Supabase](https://supabase.com) project
- [Go](https://go.dev/dl/) 1.21+ and a TeX distribution with `latexmk` (e.g. [MacTeX](https://www.tug.org/mactex/) or TeX Live) for the compile service
- A [Stripe](https://stripe.com) account (for billing)
- A [Claude API](https://console.anthropic.com) key (for AI features)

### Setup

```bash
git clone https://github.com/octree-labs/octree.git
cd octree
pnpm install
```

Copy the example environment file and fill in your keys:

```bash
cp apps/web/.env.example apps/web/.env.local
```

The agent reads `apps/agent/.env` (see [Hosting the agent server](#hosting-the-agent-server) for its variables). The compile service needs no configuration locally.

Start everything — local Supabase, then the web app, agent, and compile service:

```bash
pnpm dev
```

| Service | URL |
|---------|-----|
| Web app | http://localhost:3000 |
| Agent server | http://localhost:8787 |
| Compile service | http://localhost:3001 |
| Supabase API | http://localhost:54321 |

To run a single app, pass a filter: `pnpm dev --filter=@octree/web`. To use a hosted Supabase project instead of the local stack, point the Supabase variables in `apps/web/.env.local` at your project and run `pnpm turbo run dev`, which skips `supabase start`.

### Commands

Run from the repo root; each runs across all apps via Turborepo:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start local Supabase and all apps in dev mode |
| `pnpm build` | Production builds (cached) |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run all tests (Vitest for web, `go test` for compile) |

Add `--filter=<package>` to target one app, e.g. `pnpm test --filter=@octree/web`. For Vitest watch mode: `pnpm --filter @octree/web test:watch`.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict mode) |
| UI | React 19, shadcn/ui, Tailwind CSS |
| Editor | Monaco Editor |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth and Googel OAuth |
| AI | Vercel AI SDK, @ai-sdk/anthropic |
| Payments | Stripe |
| Hosting | Vercel |

## Security

If you find a security vulnerability, please email **basil@useoctree.online** instead of opening a public issue.

## Self-Hosting

### Hosting the compile service

The LaTeX compile service lives in `apps/compile` (Go + TeX Live). The web app talks to it through `COMPILE_SERVICE_URL` (server-side relay at `apps/web/app/api/compile-pdf/`) and `NEXT_PUBLIC_COMPILE_SERVICE_URL` (direct browser calls).

- **API:** `POST /compile` takes `{ files: [{ path, content }], projectId?, lastModifiedFile? }` and returns raw PDF bytes (`application/pdf`) on success, or JSON with `error`, `log`, `stdout`, `stderr` on failure. `POST /synctex` maps between source and PDF positions; `GET /health` reports queue status.
- **Auth:** when `SUPABASE_JWT_SECRET` is set, `/compile` and `/synctex` require `Authorization: Bearer <supabase-access-token>`. Leave it unset for local development.
- **Docker:** see `apps/compile/deployments/` and `apps/compile/README.md`. The deploy scripts in `apps/compile/deploy/` read the target host from `SERVER_IP`, or `DEPLOY_HOST` / `STAGING_DEPLOY_HOST` in `apps/compile/.env`. They never sync `.env`: the production `.env` (with `SUPABASE_JWT_SECRET`) lives only on the server.

### Hosting the agent server

The AI editing agent lives in `apps/agent` and can be hosted independently. Locally it runs as part of `pnpm dev` on `http://localhost:8787` and exposes `POST /agent`.

#### Production (Docker)

The image is built from a pruned copy of the monorepo containing only the agent and its workspace dependencies:

```bash
pnpm turbo prune @octree/agent --docker --out-dir out
cp apps/agent/Dockerfile apps/agent/.dockerignore apps/agent/docker-compose.yml out/
cp apps/agent/.env out/
cd out && docker build -t octra-agent:latest . && docker compose up -d
```

`apps/agent/scripts/deploy.sh` does the same on a remote host over SSH (set `DEPLOY_HOST` in `apps/agent/.env`). `docker-compose.yml` maps port `8787:8787` and reads environment variables from `.env`.

#### Required environment variables for agent server

- `ANTHROPIC_API_KEY` (required)
- `SUPABASE_JWT_SECRET` (optional but recommended; when set, `/agent` requires Bearer JWT)
- `SUPABASE_URL` (optional; also accepts tokens signed with the project's asymmetric JWT signing keys, e.g. local `supabase start` stacks)
- `COMPILE_SERVICE_URL` (optional; enables agent compile tool)
- `PORT` (optional; defaults to `8787`)

#### Connect the Next.js app to your hosted agent

Set in `apps/web/.env.local`:

```bash
CLAUDE_AGENT_SERVICE_URL=http://localhost:8787
```

If hosting remotely, replace with your public/internal URL.

## License

LGPL-3.0 — see [LICENSE](LICENSE) for details.
