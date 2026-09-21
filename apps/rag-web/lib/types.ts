import type { UIMessage } from "ai";

// Shared TypeScript types, imported by both the server (route handlers) and the browser (components).

/** One retrieved chunk as shown in the Sources panel. `n` matches the [n] citations in the answer. */
export interface Source {
  n: number;
  document: string;
  page: number | null;
  score: number;
  content: string;
}

/**
 * Our chat message type. Besides text, an assistant message can carry a custom "sources" data
 * part: the server sends it first (right after retrieval), so the UI can show what was found
 * while Claude is still writing.
 */
export type RagMessage = UIMessage<unknown, { sources: Source[] }>;
