<p align="center">
  <img src="app/icon.svg" alt="Octree Logo" width="100" />
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

### Prerequisites

- Node.js 18+
- [Docker](https://docs.docker.com/get-docker/) and the [Supabase CLI](https://supabase.com/docs/guides/cli) for the local database, or a hosted [Supabase](https://supabase.com) project
- [Go](https://go.dev/dl/) 1.21+ and a TeX distribution with `latexmk` (e.g. [MacTeX](https://www.tug.org/mactex/) or TeX Live) for the compile service
- A [Stripe](https://stripe.com) account (for billing)
- A [Claude API](https://console.anthropic.com) key (for AI features)

### Setup

```bash
git clone https://github.com/octree-labs/octree.git
cd octree
npm install
npm install --prefix services/agent
```

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env.local
```

The agent server reads `services/agent/.env` (see [Hosting the agent server](#hosting-the-agent-server)). The compile service needs no configuration locally.

Start everything from the repo root — local Supabase, then the Next.js app, agent server, and compile service in one terminal:

```bash
npm run dev:all
```

| Service | URL |
|---------|-----|
| Next.js app | http://localhost:3000 |
| Agent server | http://localhost:8787 |
| Compile service | http://localhost:3001 |
| Supabase API | http://localhost:54321 |

Supabase and the agent server are required for auth and AI features. The compile service is only needed for PDF compilation. To use a hosted Supabase project instead of the local stack, point the Supabase variables in `.env.local` at your project; `supabase start` then isn't needed, so run the services individually (`npm run dev`, `npm --prefix services/agent run dev`, `make -C services/compile run`).

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start local Supabase, the Next.js app, agent server, and compile service |
| `npm run dev` | Start the Next.js dev server only (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:watch` | Watch mode |
| `npm run resume:redesign -- <resume.pdf>` | Run the resume redesign pipeline locally (needs `ANTHROPIC_API_KEY` and `latexmk`) |

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

The LaTeX compile service lives in `services/compile/` (Go + TeX Live). The Next.js app talks to it through `COMPILE_SERVICE_URL` (server-side relay at `app/api/compile-pdf/`) and `NEXT_PUBLIC_COMPILE_SERVICE_URL` (direct browser calls).

- **API:** `POST /compile` takes `{ files: [{ path, content }], projectId?, lastModifiedFile? }` and returns raw PDF bytes (`application/pdf`) on success, or JSON with `error`, `log`, `stdout`, `stderr` on failure. `POST /synctex` maps between source and PDF positions; `GET /health` reports queue status.
- **Auth:** when `SUPABASE_JWT_SECRET` is set, `/compile` and `/synctex` require `Authorization: Bearer <supabase-access-token>`. Leave it unset for local development.
- **Docker:** see `services/compile/deployments/` and `services/compile/README.md`. The deploy scripts in `services/compile/deploy/` read the target host from `SERVER_IP`, or `DEPLOY_HOST` / `STAGING_DEPLOY_HOST` in `services/compile/.env`. They never sync `.env`: the production `.env` (with `SUPABASE_JWT_SECRET`) lives only on the server.

### Hosting the agent server

The AI editing agent is included in this repo under `services/agent/` and can be hosted independently.

#### Local/dev run

```bash
cd services/agent
npm install
cp ../../.env.example .env
# Fill required values in services/agent/.env (see below)
npm run dev
```

The service starts on `http://localhost:8787` and exposes `POST /agent`.

#### Production (Docker)

```bash
cd services/agent
docker build -t octra-agent:latest .
docker compose up -d
```

`docker-compose.yml` maps port `8787:8787` and reads environment variables from `services/agent/.env`.

#### Required environment variables for agent server

- `ANTHROPIC_API_KEY` (required)
- `SUPABASE_JWT_SECRET` (optional but recommended; when set, `/agent` requires Bearer JWT)
- `SUPABASE_URL` (optional; also accepts tokens signed with the project's asymmetric JWT signing keys, e.g. local `supabase start` stacks)
- `COMPILE_SERVICE_URL` (optional; enables agent compile tool)
- `PORT` (optional; defaults to `8787`)

#### Connect the Next.js app to your hosted agent

Set in `.env.local`:

```bash
CLAUDE_AGENT_SERVICE_URL=http://localhost:8787
```

If hosting remotely, replace with your public/internal URL.

## License

LGPL-3.0 — see [LICENSE](LICENSE) for details.
