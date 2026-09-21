// A Client Component because the <details> UI and markdown rendering run in the browser. It's a pure
// display component: it receives a message and renders it, with no state of its own.
"use client";

import { AnswerBody } from "./AnswerBody";
import type { RagMessage } from "@/lib/types";

/** One chat turn. Assistant messages carry text plus (optionally) a `sources` data part. */
export function ChatMessage({ message, pending }: { message: RagMessage; pending: boolean }) {
  if (message.role === "user") {
    return <div className="q">{message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</div>;
  }

  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const sources = message.parts.find((p) => p.type === "data-sources")?.data;

  return (
    <div>
      {/* Sources arrive before any text, so "sources but no text yet" means Claude is writing. */}
      {pending && !text && (
        <div className="thinking">
          <span className="spin" />
          {sources ? "Writing answer…" : "Searching your books…"}
        </div>
      )}
      <AnswerBody text={text} />
      {sources && sources.length > 0 && (
        <details>
          <summary>Sources</summary>
          {sources.map((s) => (
            <p key={s.n}>
              <b>
                [{s.n}] {s.document}
                {s.page ? `, p. ${s.page}` : ""}
              </b>{" "}
              ({s.score.toFixed(2)})<br />
              {s.content.slice(0, 300)}…
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
