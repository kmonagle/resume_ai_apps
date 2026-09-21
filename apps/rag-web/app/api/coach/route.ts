// POST /api/coach: runs the multi-agent Habit Coach (see lib/coach.ts for the agents themselves).
// Like /api/chat, the response is a UI message stream: progress data parts first and continuously,
// then the final plan text streamed by the synthesizer.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { requireAuth } from "@/lib/auth";
import { runCoach } from "@/lib/coach";
import type { CoachMessage } from "@/lib/coachTypes";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const body = (await req.json()) as { messages: CoachMessage[]; documentIds?: number[] };
  const last = [...body.messages].reverse().find((m) => m.role === "user");
  const situation = last?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ").trim();
  if (!situation) return Response.json({ error: "Describe your situation first" }, { status: 400 });
  if (!body.documentIds?.length) return Response.json({ error: "Select at least one book" }, { status: 400 });

  const stream = createUIMessageStream<CoachMessage>({
    onError: (e) => (e instanceof Error ? e.message : "Something went wrong"),
    execute: ({ writer }) => runCoach(situation, body.documentIds!, writer),
  });
  return createUIMessageStreamResponse({ stream });
}
