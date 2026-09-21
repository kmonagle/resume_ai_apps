// The Habit Coach page, served at "/coach" (folder name = URL). A Client Component like the chat
// page: it uses state and useChat. It posts your situation to /api/coach, which runs the planner,
// the per-book agents, and the synthesizer (see lib/coach.ts), and streams progress plus the final plan.
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";
import { AnswerBody } from "@/components/AnswerBody";
import { BookSidebar, type Doc } from "@/components/BookSidebar";
import { CoachProgress } from "@/components/CoachProgress";
import type { CoachMessage } from "@/lib/coachTypes";

export default function CoachPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/coach" }), []);
  const { messages, sendMessage, status, error } = useChat<CoachMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";

  async function loadDocs() {
    const list: Doc[] = await (await fetch("/api/documents")).json();
    setDocs(list);
    setSelected((prev) => (prev.size ? new Set(list.filter((d) => prev.has(d.id)).map((d) => d.id)) : new Set(list.map((d) => d.id))));
  }
  useEffect(() => {
    void loadDocs();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (selected.size === 0) return setNotice("Select at least one book.");
    setNotice("");
    setInput("");
    void sendMessage({ text }, { body: { documentIds: [...selected] } });
  }

  return (
    <main>
      <BookSidebar
        docs={docs}
        selected={selected}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
          })
        }
        onChanged={loadDocs}
      />
      <section className="card">
        <h1>Habit Coach</h1>
        <p className="hint">
          Describe a habit you want to build or change. One agent per checked book researches it, then a final agent
          merges their findings into a plan. Takes about 30-40 seconds.
        </p>
        <div className="log">
          {messages.map((m, i) => {
            if (m.role === "user") return <div key={m.id} className="q">{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</div>;
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            const isLast = i === messages.length - 1;
            return (
              <div key={m.id}>
                <CoachProgress message={m} running={busy && isLast && !text} />
                <AnswerBody text={text} />
              </div>
            );
          })}
          {/* Before the server's first chunk there's no assistant message yet. */}
          {status === "submitted" && (
            <div className="thinking">
              <span className="spin" />
              Starting…
            </div>
          )}
          {status === "error" && <div className="error">Error: {error?.message ?? "request failed"}</div>}
        </div>
        <form onSubmit={submit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. I want to start running in the morning but keep quitting after a week"
            autoComplete="off"
          />
          <button className="primary" disabled={busy}>
            {busy ? "Working…" : "Coach me"}
          </button>
        </form>
        {notice && <div className="status">{notice}</div>}
      </section>
    </main>
  );
}
