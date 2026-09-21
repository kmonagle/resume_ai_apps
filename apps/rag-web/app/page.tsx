// NEXT.JS: app/page.tsx is the page served at "/" (the folder structure IS the URL structure:
// app/foo/page.tsx would be "/foo").
//
// "use client" makes this a Client Component. By default, App Router components are Server
// Components (rendered on the server, no interactivity). Anything using React state, effects,
// event handlers, or hooks like useChat has to be a Client Component, so it runs in the browser.
// The directive must be the first line of the file.
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookSidebar, type Doc } from "@/components/BookSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import type { RagMessage } from "@/lib/types";

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [balanced, setBalanced] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");

  // React state: when a setX function is called, React re-renders the component with the new value.
  // `docs` = all books, `selected` = ids of the ticked ones, `balanced` = the balance toggle.
  // useChat manages the message list, the streaming, and the loading/error state for us. The
  // transport says where to POST; `status` is "submitted" -> "streaming" -> "ready" (or "error").
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error } = useChat<RagMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";

  // Fetches the book list from our own API route (app/api/documents/route.ts). The browser
  // automatically includes the password credentials for same-origin requests like this one.
  const loadDocs = useCallback(async () => {
    const list: Doc[] = await (await fetch("/api/documents")).json();
    setDocs(list);
    // Newly added books start ticked; books that were removed drop out of the selection.
    setSelected((prev) => {
      const known = new Set(docs.map((d) => d.id));
      const next = new Set<number>();
      for (const d of list) if (prev.has(d.id) || !known.has(d.id)) next.add(d.id);
      return next;
    });
  }, [docs]);

  // useEffect with an empty dependency list runs once, after the first render: load the books.
  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (selected.size === 0) return setNotice("Select at least one book.");
    setNotice("");
    setInput("");
    // The second argument adds extra fields to this request's JSON body: which books to search
    // and whether to balance retrieval across them.
    void sendMessage({ text }, { body: { documentIds: [...selected], balanced } });
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
        balanced={balanced}
        onBalanced={setBalanced}
        onChanged={loadDocs}
      />
      <section className="card">
        <h1>Ask your documents</h1>
        <div className="log">
          {messages.map((m, i) => (
            <ChatMessage key={m.id} message={m} pending={busy && i === messages.length - 1} />
          ))}
          {/* Before the server's first chunk there's no assistant message yet, so show the spinner here. */}
          {status === "submitted" && (
            <div className="thinking">
              <span className="spin" />
              Searching your books…
            </div>
          )}
          {status === "error" && <div className="error">Error: {error?.message ?? "request failed"}</div>}
        </div>
        <form onSubmit={submit}>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" autoComplete="off" />
          <button className="primary" disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </form>
        {notice && <div className="status">{notice}</div>}
      </section>
    </main>
  );
}
