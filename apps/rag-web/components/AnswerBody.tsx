"use client";

import ReactMarkdown from "react-markdown";

/** Splits Claude's "TL;DR: ...\n\n details" format so the TL;DR can be styled as a callout. */
function splitTldr(text: string): { tldr?: string; body: string } {
  const i = text.indexOf("\n\n");
  if (/^TL;DR:/i.test(text) && i >= 0) return { tldr: text.slice(0, i).replace(/^TL;DR:\s*/i, ""), body: text.slice(i + 2) };
  // Still streaming the first paragraph: show it as the callout right away.
  if (/^TL;DR:/i.test(text)) return { tldr: text.replace(/^TL;DR:\s*/i, ""), body: "" };
  return { body: text };
}

/** Renders an answer: the TL;DR as a highlighted callout, the rest as markdown. Shared by chat and coach. */
export function AnswerBody({ text }: { text: string }) {
  const { tldr, body } = splitTldr(text);
  return (
    <>
      {tldr !== undefined && <div className="tldr">TL;DR: {tldr}</div>}
      {body && (
        <div className="answer">
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>
      )}
    </>
  );
}
