// GENERATION
// This is the "G" in RAG. Retrieval already picked the relevant chunks; here we hand only those
// to Claude and ask it to answer from them. Claude never sees the whole library.

import Anthropic from "@anthropic-ai/sdk";
import type { Hit } from "./db.ts";

export const MODEL = "claude-sonnet-5";
// Created lazily so importing this module (e.g. during `next build`) doesn't require the API key.
let _client: Anthropic | undefined;
const client = () => (_client ??= new Anthropic()); // reads ANTHROPIC_API_KEY from the environment

// The system prompt is the main lever for answer behavior. It controls:
//  - grounding: "only the provided sources" plus an explicit way out ("say so plainly")
//    is what stops Claude from inventing answers when retrieval comes up empty
//  - format: the TL;DR-first layout the UI looks for
//  - citations: [n] numbers must match the numbered sources we build below
export const ANSWER_SYSTEM_PROMPT = `You answer questions using only the provided sources.
Format: start with a "TL;DR:" line of one or two sentences giving the main takeaway, then a blank line, then the supporting detail. Keep the detail concise: short paragraphs or a brief bullet list, no filler, and no repeating the TL;DR.
Cite sources inline like [1], [2] matching the source numbers. When sources come from different books, attribute ideas to the right author and note where they agree or differ. If the sources don't contain the answer, say so plainly instead of guessing.`;

/**
 * Builds the user message: numbered sources followed by the question. Each chunk is labeled with
 * book and page. Claude cites by these numbers, and the UI's Sources panel uses the same
 * numbering, so [3] in the answer is source 3 on screen. Shared by every front end.
 */
export function buildUserPrompt(question: string, hits: Hit[]): string {
  const context = hits.map((h, i) => `[${i + 1}] (${h.document}${h.page ? `, p. ${h.page}` : ""})\n${h.content}`).join("\n\n---\n\n");
  return `Sources:\n\n${context}\n\nQuestion: ${question}`;
}

/** Streams an answer grounded in the retrieved hits. Calls onText for each text delta. */
export async function answerWithSources(question: string, hits: Hit[], onText: (t: string) => void) {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 1024, // caps answer length (and cost); lower it for terser answers
    system: ANSWER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(question, hits) }],
  });
  // Streaming means the user sees words as they're generated instead of waiting for the whole reply.
  stream.on("text", onText);
  await stream.finalMessage();
}
