"use client";

import type { AgentState, CoachMessage } from "@/lib/coachTypes";

const ICON: Record<AgentState["status"], string> = { searching: "…", writing: "…", done: "✓", error: "✕" };

/**
 * Shows what the multi-agent run is doing: the current stage, the planner's questions, and one row
 * per book agent with the searches it chose and (when done) its notes. The data comes from the
 * custom data parts the server streams; the SDK keeps the latest copy of each part id, so this
 * re-renders live as agents work.
 */
export function CoachProgress({ message, running }: { message: CoachMessage; running: boolean }) {
  const stage = message.parts.find((p) => p.type === "data-stage")?.data.label;
  const plan = message.parts.find((p) => p.type === "data-plan")?.data.subQuestions;
  const agents = message.parts.flatMap((p) => (p.type === "data-agent" ? [p.data] : []));

  return (
    <div className="progress">
      {stage && (
        <div className="thinking">
          {running && <span className="spin" />}
          {running ? stage : "Finished"}
        </div>
      )}
      {plan && (
        <details>
          <summary>Planner: {plan.length} questions</summary>
          <ul className="plain">
            {plan.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </details>
      )}
      {agents.map((a) => (
        <details key={a.bookId} className={`agent ${a.status}`}>
          <summary>
            <span className="badge">{ICON[a.status]}</span> {a.book}
            <small>
              {" "}
              · {a.searches.length} search{a.searches.length === 1 ? "" : "es"}
            </small>
          </summary>
          {a.searches.length > 0 && (
            <ul className="plain">
              {a.searches.map((q, i) => (
                <li key={i}>🔎 {q}</li>
              ))}
            </ul>
          )}
          {a.summary && <p>{a.summary}</p>}
          {a.error && <p className="error">{a.error}</p>}
        </details>
      ))}
    </div>
  );
}
