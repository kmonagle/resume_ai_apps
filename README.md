# ai-apps

Small AI apps built to learn RAG and (next) multi-agent workflows. The first app is **RAG Chat**: upload
books or documents, then ask questions and get streamed answers with citations (book and page).

## How it works

```
Upload:  file -> extract text per page -> chunk (~1000 chars) -> embed (Voyage) -> store (Postgres + pgvector)
Ask:     question -> embed (Voyage) -> nearest chunks (pgvector) -> Claude answers from those chunks only
```

| Piece | What it does | Where |
|---|---|---|
| Chunking | Splits pages into small, overlapping passages, keeping page numbers | `packages/core/src/chunk.ts` |
| Embeddings | Turns text into vectors so similar meaning lands nearby (Voyage `voyage-3.5`) | `packages/core/src/embed.ts` |
| Storage and search | Postgres with pgvector; cosine-distance nearest-neighbor query, optional per-book balancing | `packages/core/src/db.ts` |
| Generation | Claude answers only from the retrieved chunks, cites `[n]`, leads with a TL;DR | `packages/core/src/claude.ts` |
| Web app | Next.js UI with the Vercel AI SDK (`useChat`), password protection | `apps/rag-web` |

## Repo layout

```
packages/core/     shared RAG logic (chunking, embeddings, pgvector, Claude prompt)
apps/rag-web/      Next.js app (the one to use). See its README for a tour of the Next.js structure
apps/rag-chat/     original Express + plain HTML version (kept for reference)
render.yaml        Render Blueprint for deploying rag-web
```

## Prerequisites

- Node.js 20 or newer
- A **Neon** Postgres database (free tier works; pgvector is enabled automatically by the app)
- A **Voyage AI** API key for embeddings. Add a payment method to lift the very low default rate limits;
  the free token allowance still applies
- An **Anthropic API key** (console.anthropic.com). A Claude.ai subscription does not include API access

## Run locally

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run dev:rag           # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (answers) |
| `VOYAGE_API_KEY` | Embeddings |
| `DATABASE_URL` | Neon connection string, e.g. `postgresql://user:pass@host/db?sslmode=require` |
| `APP_PASSWORD` | Shared password for the UI (any username). Blank = no prompt, for localhost only |

Then upload PDFs, `.txt`, or `.md` files in the sidebar. PDFs must have a text layer (scans need OCR first).
Tick which books to search; **Balance across books** takes the top results from each book, which is best for
comparison questions.

Other scripts: `npm run build:rag`, `npm run typecheck`, `npm run dev:rag-express` (old Express app).

## Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New, Blueprint**, then select the repo. It reads `render.yaml`.
3. Set the four secrets: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `APP_PASSWORD`.

The app refuses to serve on Render if `APP_PASSWORD` is unset. The default plan in `render.yaml` is `starter`
(paid); use `free` for a demo that sleeps when idle.

## Notes and cautions

- **Cost:** every question and upload calls the Anthropic and Voyage APIs. Set spend limits in both dashboards.
- **Password:** one shared password guards the whole app, and anyone with it can also upload and delete books.
- **Copyright:** don't leave full text from commercial books searchable on a public deployment. Keep it
  behind the password, or use content you own or have licensed.
- Each question is answered independently (no conversation memory).

## Ideas for next steps

Hybrid search plus a reranker, filtering junk chunks, a saved set of test questions for evaluation, and a
multi-agent "habit coach" (planner, one agent per book, synthesizer).
