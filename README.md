<p align="center">
  <img src="public/Logo.svg" alt="Octree Logo" width="100" />
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
- A [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account (for billing)
- A [Claude API](https://console.anthropic.com) key (for AI features)

### Setup

```bash
git clone https://github.com/octree-labs/octree.git
cd octree
npm install
```

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env.local
```

Start both the Next.js app and the agent server:

```bash
# Terminal 1 — Next.js app
npm run dev

# Terminal 2 — Agent server
cd agent_server
npm install
npm run dev    # starts on port 8787
```

Both services need to be running for AI features to work.

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:watch` | Watch mode |

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

### Compile API status (important)

The `/api/compile-pdf` endpoint in this repo is **not a full compiler implementation**. It is a relay that forwards compile requests to an external compile backend via `COMPILE_SERVICE_URL`.

- Code path: `app/api/compile-pdf/route.ts` → `app/api/compile-pdf/compiler.ts`
- Runtime dependency: `COMPILE_SERVICE_URL` must point to a service exposing `POST /compile`

The production compile backend used by Octree is currently closed-source.

### Fallback option if you are self-hosting

If you are self-hosting and need compile to work, you can run your own LaTeX compile service and wire it in:

1. Host any HTTP service that accepts `POST /compile` with:
   - Request JSON: `{ files: [{ path, content }], projectId?, lastModifiedFile? }`
   - Auth header: `Authorization: Bearer <supabase-access-token>` (or adjust auth in your own service)
2. Make your service return either:
   - Success: raw PDF bytes in response body (content-type `application/pdf`), or
   - Error: JSON with fields such as `error`, `details/message`, `log`, `stdout`, `stderr`
3. Set `COMPILE_SERVICE_URL` in `.env.local` to your hosted service URL.
4. If your API shape differs, update `app/api/compile-pdf/compiler.ts` (and if needed `app/api/compile-pdf/route.ts`) so this relay matches your service contract.

This gives you a practical path to run compilation even without the closed-source backend.

### Hosting the agent server

The AI editing agent is included in this repo under `agent_server/` and can be hosted independently.

#### Local/dev run

```bash
cd agent_server
npm install
cp ../.env.example .env
# Fill required values in agent_server/.env (see below)
npm run dev
```

The service starts on `http://localhost:8787` and exposes `POST /agent`.

#### Production (Docker)

```bash
cd agent_server
docker build -t octra-agent:latest .
docker compose up -d
```

`docker-compose.yml` maps port `8787:8787` and reads environment variables from `agent_server/.env`.

#### Required environment variables for agent server

- `ANTHROPIC_API_KEY` (required)
- `SUPABASE_JWT_SECRET` (optional but recommended; when set, `/agent` requires Bearer JWT)
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
