// MULTI-AGENT ORCHESTRATION
// The Habit Coach runs three kinds of agents:
//
//   1. Planner      one call: turns the user's situation into a few focused sub-questions
//   2. Book agents  one per selected book, run IN PARALLEL. Each is an LLM with a `search_book`
//                   tool restricted to its own book. It decides what to search for (and whether
//                   a second or third search is needed) and writes up that author's advice.
//   3. Synthesizer  one streamed call: merges every book's write-up into a single plan and
//                   points out where the authors agree and differ.
//
// "Agent" here means an LLM in a loop that can call tools and decide its own next step; the
// orchestration code around them is ordinary async TypeScript (Promise.all, try/catch).

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, Output, streamText, tool, toUIMessageStream } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { MODEL as STRONG_MODEL, embedQuery, listDocuments, search } from "@ai-apps/core";
import type { AgentState, CoachMessage } from "./coachTypes";

// Cheap and fast for the many small calls (planner and book agents); the strong model writes the
// final plan, which is the part the user actually reads.
const FAST_MODEL = "claude-haiku-4-5-20251001";

/** Runs the whole coach flow, writing progress and the final answer into `writer`. */
export async function runCoach(situation: string, documentIds: number[], writer: UIMessageStreamWriter<CoachMessage>) {
  const stage = (label: string) => writer.write({ type: "data-stage", id: "stage", data: { label } });

  // ---- 1. Planner ---------------------------------------------------------------------------
  stage("Planning: breaking your situation into questions…");
  const { output: plan } = await generateText({
    model: anthropic(FAST_MODEL),
    // Structured output: the model must return JSON matching this schema, so we get a real array
    // back instead of text we'd have to parse.
    output: Output.object({ schema: z.object({ subQuestions: z.array(z.string()).min(2).max(4) }) }),
    prompt: `A person wants help with a habit or behavior change. Break their situation into 3 or 4 short, focused questions to research in books about habit formation (for example: designing cues, making the behavior easy to start, motivation, handling setbacks, identity). Each question should be self-contained.\n\nTheir situation: ${situation}`,
  });
  writer.write({ type: "data-plan", id: "plan", data: { subQuestions: plan.subQuestions } });

  // ---- 2. Book agents, in parallel ----------------------------------------------------------
  const books = (await listDocuments()).filter((d) => documentIds.includes(d.id));
  stage(`Researching: ${books.length} book agents working in parallel…`);
  const findings = await Promise.all(books.map((b) => runBookAgent(b.id, b.name, situation, plan.subQuestions, writer)));

  // ---- 3. Synthesizer -----------------------------------------------------------------------
  const usable = findings.filter((f) => f.summary);
  if (!usable.length) throw new Error("None of the book agents produced findings. Check the server logs.");
  stage("Synthesizing: writing your plan…");

  const result = streamText({
    model: anthropic(STRONG_MODEL),
    system: `You are a habit-change coach. You are given research notes, one set per book, each written by a separate researcher who read only that book. Write a plan for the person using only those notes.
Format: start with a "TL;DR:" line of one or two sentences with the main takeaway, then a blank line. Then these markdown sections: "## Where the authors agree", "## Where they differ" (skip if there are no real differences), and "## Your plan" (3 to 6 concrete steps the person can start this week, in order).
Cite claims as (Book name, p. N) using the book names and page numbers from the notes. Attribute ideas to the right author. Be concise and practical; do not invent advice that isn't in the notes.`,
    prompt: `The person's situation: ${situation}\n\nSub-questions that were researched:\n${plan.subQuestions.map((q) => `- ${q}`).join("\n")}\n\nResearch notes:\n\n${usable.map((f) => `### ${f.book}\n${f.summary}`).join("\n\n")}`,
    maxOutputTokens: 1800,
  });
  // Stream the synthesizer's text straight into the same response the progress data went through.
  writer.merge(toUIMessageStream({ stream: result.stream }));
}

/**
 * One book agent. It is an LLM loop with a single tool. Each turn the model may call
 * `search_book` (we run the search and hand the results back) or stop and write its summary.
 * `stopWhen` caps the number of turns so a confused agent can't loop forever.
 */
async function runBookAgent(
  bookId: number,
  book: string,
  situation: string,
  subQuestions: string[],
  writer: UIMessageStreamWriter<CoachMessage>,
): Promise<AgentState> {
  const state: AgentState = { bookId, book, status: "searching", searches: [] };
  // Sending the full state with the same id each time makes the UI update this agent's row in place.
  const publish = () => writer.write({ type: "data-agent", id: `agent-${bookId}`, data: { ...state, searches: [...state.searches] } });
  publish();

  try {
    const result = await generateText({
      model: anthropic(FAST_MODEL),
      system: `You are a researcher who can only read one book: "${book}". Use the search_book tool to find what this book says about the person's situation and questions. Run no more than 3 searches in total (refine your queries if the first results are thin). Then write concise notes (bullets are fine), starting directly with the notes and with no preamble or commentary about your process, on the book's advice, attributing it to the book's author. After each claim add the page in the form (p. N), using page numbers from the search results. Only report what the search results contain. If the book says little about something, say so.`,
      prompt: `Situation: ${situation}\n\nQuestions to research:\n${subQuestions.map((q) => `- ${q}`).join("\n")}`,
      tools: {
        search_book: tool({
          description: `Search the book "${book}" for passages relevant to a query. Returns the most relevant passages with page numbers.`,
          inputSchema: z.object({ query: z.string().describe("A focused search query in natural language") }),
          // This is what runs when the model decides to search. The agent picks the query; we run
          // the same embed + pgvector search as the chat app, restricted to this one book.
          execute: async ({ query }) => {
            state.searches.push(query);
            publish();
            const hits = await search(await embedQuery(query), { k: 4, documentIds: [bookId] });
            return hits.map((h) => ({ page: h.page, text: h.content }));
          },
        }),
      },
      // Up to 3 search turns plus the final write-up turn.
      stopWhen: isStepCount(4),
      maxOutputTokens: 900,
    });
    state.status = result.text.trim() ? "done" : "error";
    state.summary = result.text.trim() || undefined;
    if (!state.summary) state.error = "The agent finished without writing notes.";
  } catch (e) {
    // One failing agent shouldn't sink the whole run: record the error and carry on.
    console.error(`book agent failed (${book})`, e);
    state.status = "error";
    state.error = e instanceof Error ? e.message : "failed";
  }
  publish();
  return state;
}
