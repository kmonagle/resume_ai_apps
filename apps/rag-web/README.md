# rag-web: how this Next.js app is organized

Next.js (App Router) uses the **folder structure as the routing**. Anything under `app/` maps to a URL.

```
apps/rag-web/
  app/
    layout.tsx            wraps every page (<html>, <body>, global CSS)
    page.tsx              the page at "/"  (client component: chat UI)
    globals.css           styles, imported by layout.tsx
    coach/page.tsx        the page at "/coach"  (multi-agent Habit Coach UI)
    healthz/route.ts      GET /healthz            (Render's health check)
    api/
      chat/route.ts       POST /api/chat          question -> retrieval -> streamed answer
      upload/route.ts     POST /api/upload        PDF/text -> chunks -> embeddings -> Postgres
      coach/route.ts      POST /api/coach         runs the multi-agent flow (see lib/coach.ts)
      documents/route.ts  GET  /api/documents     list books
      documents/[id]/route.ts   DELETE /api/documents/7   ([id] = dynamic segment)
  components/             our React components (BookSidebar, ChatMessage)
  lib/                    shared helpers (auth, types, coach.ts = the agents and orchestration)
  proxy.ts                runs BEFORE requests reach pages: password prompt for the UI
  instrumentation.ts      runs ONCE at server startup: config check + database setup
  next.config.ts          project-wide Next settings
```

## Concepts worth knowing

- **Server vs Client Components.** Files in `app/` are *Server Components* by default: they render on
  the server and can't use state or click handlers. Add `"use client"` at the top of a file to make it
  run in the browser (needed for `useState`, `useChat`, event handlers).
- **Route handlers** (`route.ts`) are API endpoints. Export a function named after the HTTP method
  (`GET`, `POST`, `DELETE`). They use standard `Request`/`Response` objects and only run on the server.
- **Special file names** carry meaning: `page.tsx` (a page), `layout.tsx` (a wrapper), `route.ts` (an
  endpoint), `proxy.ts` (request gate), `instrumentation.ts` (startup hook).
- **Where the RAG logic lives:** not here. Chunking, embeddings, pgvector search, and the Claude
  prompt are in `packages/core`; this app is the web layer on top.

## Request flow for one question

1. `page.tsx` calls `sendMessage` (from the Vercel AI SDK's `useChat`), which POSTs to `/api/chat`.
2. `proxy.ts` is skipped for `/api/*`; `route.ts` checks the password itself (`lib/auth.ts`).
3. The handler embeds the question, searches Postgres, sends the sources, then streams Claude's answer.
4. `useChat` assembles the stream into messages; `ChatMessage.tsx` renders them.
