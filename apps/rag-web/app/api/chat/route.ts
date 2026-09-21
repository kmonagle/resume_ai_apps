// NEXT.JS: a file named route.ts inside app/api/chat/ defines an API endpoint at /api/chat. Exporting
// a function named after an HTTP method (POST here) handles that method. These "route handlers" use
// the standard Web Request/Response objects, and they only ever run on the server.
//
// QUERY: embed the question -> retrieve nearest chunks -> Claude answers from them.
//
// The response is a Vercel AI SDK "UI message stream": one SSE stream that carries our custom
// `sources` data part first, then Claude's text as it is generated. The client hook (useChat)
// understands this format, so we no longer hand-roll SSE or stream parsing.

import { anthropic } from "@ai-sdk/anthropic";
import { createUIMessageStream, createUIMessageStreamResponse, streamText, toUIMessageStream } from "ai";
import { ANSWER_SYSTEM_PROMPT, MODEL, buildUserPrompt, embedQuery, search } from "@ai-apps/core";
import { requireAuth } from "@/lib/auth";
import type { RagMessage } from "@/lib/types";

// Which JavaScript runtime runs this route. "nodejs" gives us full Node APIs (needed for pg).
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const body = (await req.json()) as { messages: RagMessage[]; documentIds?: number[]; balanced?: boolean };

  // Each question is answered on its own (retrieval uses just the latest question). The chat
  // history is displayed by the UI but not sent to Claude.
  const last = [...body.messages].reverse().find((m) => m.role === "user");
  const question = last?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ").trim();
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });

  const stream = createUIMessageStream<RagMessage>({
    // Runs inside the stream, so a failure (Voyage down, bad key...) surfaces as a chat error.
    onError: (e) => (e instanceof Error ? e.message : "Something went wrong"),
    execute: async ({ writer }) => {
      // RETRIEVE: embed the question with the same model used for the chunks, then ask Postgres
      // for the nearest ones. k=10 gives Claude enough context for multi-part questions.
      const hits = await search(await embedQuery(question), {
        k: 10,
        documentIds: body.documentIds,
        perDocument: body.balanced ? 4 : undefined, // top 4 per book so no author dominates
      });

      // Send the sources first, before any text.
      writer.write({
        type: "data-sources",
        data: hits.map((h, i) => ({ n: i + 1, document: h.document, page: h.page, score: h.score, content: h.content })),
      });

      // GENERATE: Claude answers from those chunks only.
      const result = streamText({
        model: anthropic(MODEL),
        system: ANSWER_SYSTEM_PROMPT,
        prompt: hits.length ? buildUserPrompt(question, hits) : `No documents are available. Question: ${question}`,
        maxOutputTokens: 1024,
      });
      writer.merge(toUIMessageStream({ stream: result.stream }));
    },
  });

  return createUIMessageStreamResponse({ stream });
}
