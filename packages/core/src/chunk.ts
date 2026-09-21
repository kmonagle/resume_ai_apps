// CHUNKING
// A book is far too big to embed as one vector, and one vector for a whole book would be a
// blurry average of everything in it. So we cut text into small pieces ("chunks"), each of
// which gets its own embedding. Each chunk should be roughly one idea: small enough to be
// specific, big enough to make sense on its own.

export interface Chunk {
  content: string;
  /** 1-based PDF page number, or null for plain text files. Used for citations. */
  page: number | null;
}

/**
 * Fallback for a single paragraph that is longer than the chunk size (common in PDFs, where
 * line breaks inside a page often aren't paragraph breaks). Prefers to cut at a sentence end
 * so we don't slice a thought in half, and falls back to a hard cut if there's no good spot.
 */
function hardSplit(p: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < p.length) {
    let end = Math.min(start + size, p.length);
    if (end < p.length) {
      const window = p.slice(start, end);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      // Only use the sentence boundary if it's past the halfway point; otherwise the chunk
      // would come out tiny, which is the failure mode we're trying to avoid.
      if (cut > size * 0.5) end = start + cut + 1;
    }
    out.push(p.slice(start, end).trim());
    if (end >= p.length) break;
    // Step back by `overlap` so the next chunk begins with the end of this one.
    // `start + 1` guarantees forward progress even with odd inputs.
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

/**
 * Packs paragraphs into chunks of up to `size` characters.
 *
 * `overlap` is the tail of the previous chunk that gets repeated at the start of the next one.
 * Without it, an idea that straddles a chunk boundary would be split across two chunks and
 * neither would embed it well. This is a tuning knob: try changing `size` and see how
 * retrieval quality shifts.
 */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/) // blank line = paragraph break
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim()) // single newlines are just line wrapping
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    // Adding this paragraph would overflow: close the current chunk and start the next one
    // seeded with the overlap.
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur.trim());
      cur = cur.slice(-overlap);
    }
    if (p.length > size) {
      if (cur.trim()) chunks.push(cur.trim());
      chunks.push(...hardSplit(p, size, overlap));
      cur = "";
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/**
 * Chunks each PDF page on its own, so every chunk belongs to exactly one page and we can
 * cite "p. 143". The tradeoff: a paragraph that runs across a page break gets split in two.
 * Also note short pages (chapter titles, blank pages) produce tiny junk chunks like
 * "Appendix", which are worth filtering out.
 */
export function chunkPages(pages: string[], size = 1000, overlap = 150): Chunk[] {
  return pages.flatMap((text, i) => chunkText(text, size, overlap).map((content) => ({ content, page: i + 1 })));
}
