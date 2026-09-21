// A Client Component because react-markdown and the <details> UI run in the browser. It's a pure
// display component: it receives a message and renders it, with no state of its own.
"use client";

import ReactMarkdown from "react-markdown";
import type { RagMessage } from "@/lib/types";

/** Splits Claude's "TL;DR: ...\n\n details" format so the TL;DR can be styled as a callout. */
function splitTldr(text: string): { tldr?: string; body: string } {
  const i = text.indexOf("\n\n");
  if (/^TL;DR:/i.test(text) && i >= 0) return { tldr: text.slice(0, i).replace(/^TL;DR:\s*/i, ""), body: text.slice(i + 2) };
  // Still streaming the first paragraph: show it as the callout right away.
  if (/^TL;DR:/i.test(text)) return { tldr: text.replace(/^TL;DR:\s*/i, ""), body: "" };
  return { body: text };
}

/** One chat turn. Assistant messages carry text plus (optionally) a `sources` data part. */
export function ChatMessage({ message, pending }: { message: RagMessage; pending: boolean }) {
  if (message.role === "user") {
    return <div className="q">{message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</div>;
  }

  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const sources = message.parts.find((p) => p.type === "data-sources")?.data;
  const { tldr, body } = splitTldr(text);

  return (
    <div>
      {/* Sources arrive before any text, so "sources but no text yet" means Claude is writing. */}
      {pending && !text && (
        <div className="thinking">
          <span className="spin" />
          {sources ? "Writing answer…" : "Searching your books…"}
        </div>
      )}
      {tldr !== undefined && <div className="tldr">TL;DR: {tldr}</div>}
      {body && (
        <div className="answer">
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>
      )}
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
