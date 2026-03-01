<p align="center">
  <img src="public/octree.svg" alt="Octree Logo" width="100" />
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
  <a href="https://github.com/basilysf1709/octree">GitHub</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/framework-Next.js_15-black" alt="framework" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6" alt="language" />
  <img src="https://img.shields.io/badge/database-Supabase-3ECF8E" alt="database" />
  <img src="https://img.shields.io/badge/AI-Claude_Agent_SDK-D97706" alt="AI" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
</p>

## Architecture

```mermaid
graph TB
    subgraph Client
        A[Browser] -->|React 19 + Monaco Editor| B[Next.js 15 App Router]
    end

    subgraph Vercel
        B -->|API Routes| C[Compile PDF]
        B -->|API Routes| D[Import LaTeX]
        B -->|SSE Stream| E[Octra Agent Proxy]
    end

    subgraph DigitalOcean VPS
        E -->|HTTP + SSE| F[Claude Server<br/>Express + Claude Agent SDK]
        F -->|Tool Use| G[LaTeX AST Edits]
        F -->|Tool Use| H[Intent Inference]
    end

    subgraph Supabase
        B -->|Auth + Realtime| I[(PostgreSQL)]
        I --- J[Projects & Files]
        I --- K[Generated Documents]
        I --- L[User Usage & Billing]
    end

    subgraph External
        F -->|API| M[Claude API]
        C -->|API| N[LaTeX Compiler]
        B -->|Webhooks| O[Stripe]
    end
```

## What is Octree?

Octree is an AI-powered LaTeX editor that brings intelligent writing assistance to academic and technical document creation. Write LaTeX in a Monaco-based editor, chat with Claude for help, and compile to PDF — all in one place.

**Key features:**

- **AI edit suggestions** — Claude analyzes your LaTeX and proposes inline edits you can accept or reject
- **Document generation** — describe what you need in chat and get a full LaTeX document
- **Live PDF compilation** — compile and preview your document without leaving the editor
- **Project-based workspace** — organize files into projects with a familiar file tree
- **Real-time collaboration** — invite collaborators to work on projects together
- **Zotero integration** — sync your reference library directly into projects

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account (for billing)
- A [Deepgram](https://deepgram.com) or Claude API key (for AI features)

### Setup

```bash
git clone https://github.com/basilysf1709/octree.git
cd octree
npm install
```

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env.local
```

Start the development server:

```bash
npm run dev
```

To run the Claude agent server locally:

```bash
cd claude_server
npm install
npm run dev    # starts on port 8787
```

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
| Auth | Supabase Auth |
| AI | Claude Agent SDK |
| Payments | Stripe |
| Hosting | Vercel (app), DigitalOcean (agent server) |

## Security

If you find a security vulnerability, please email **basil@useoctree.online** instead of opening a public issue.

## Self-Hosting

If you want to self-host Octree, please reach out to **basil@useoctree.online**.

## License

MIT
