// A Client Component (see the note in app/page.tsx): it has state, refs, and click handlers, so it
// must run in the browser. Components live in /components by convention; Next doesn't treat this
// folder specially (only files inside /app become routes).
"use client";

import { useRef, useState } from "react";

export interface Doc {
  id: number;
  name: string;
  chunks: number;
}

interface Props {
  docs: Doc[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  /** The balance toggle is only shown when these are provided (the coach always searches per book). */
  balanced?: boolean;
  onBalanced?: (v: boolean) => void;
  onChanged: () => void; // called after an upload or delete so the parent reloads the list
}

/** Book list with checkboxes (which books to search), upload, delete, and the balance toggle. */
export function BookSidebar({ docs, selected, onToggle, balanced, onBalanced, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");

  async function upload(file: File) {
    setStatus(`Embedding ${file.name}… (this can take a minute or two)`);
    const body = new FormData();
    body.append("file", file);
    // The browser re-sends the Basic-auth password automatically for same-origin requests.
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
    setStatus(res.ok ? `Added ${json.name} (${json.chunks} chunks)` : `Error: ${json.error}`);
    onChanged();
  }

  async function remove(id: number) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <aside className="card">
      <h1>Documents</h1>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {/* The visible button just opens the hidden file input; the upload starts when a file is chosen. */}
      <button onClick={() => fileRef.current?.click()}>Upload PDF / txt / md</button>
      <div className="status">{status}</div>
      <ul>
        {docs.map((d) => (
          <li key={d.id}>
            <label>
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => onToggle(d.id)} />
              <span>
                {d.name}
                <small>{d.chunks} chunks</small>
              </span>
            </label>
            <button className="x" title="Delete" onClick={() => remove(d.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {onBalanced && (
        <label className="opt">
          <input type="checkbox" checked={!!balanced} onChange={(e) => onBalanced(e.target.checked)} /> Balance across books
        </label>
      )}
      <small className="hint">Checked books are searched; unchecked are excluded.</small>
    </aside>
  );
}
