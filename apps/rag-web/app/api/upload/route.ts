// INGEST: upload a book -> extract text -> chunk -> embed -> store.
import { extractText, getDocumentProxy } from "unpdf";
import { addDocument, chunkPages, chunkText, embedDocuments, type Chunk } from "@ai-apps/core";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const denied = requireAuth(req); // the proxy doesn't cover this route, so we check here
  if (denied) return denied;

  try {
    // req.formData() parses the multipart upload sent by the browser's FormData. It's the standard
    // Web API, so there's no multer-style middleware like there was with Express.
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "File too large (50 MB max)" }, { status: 413 });
    const name = file.name.replace(/\.(pdf|txt|md)$/i, "");

    // 1. Extract text and chunk it.
    let chunks: Chunk[];
    if (/\.pdf$/i.test(file.name)) {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      // mergePages:false returns one string per page, which is how each chunk gets a page number.
      // Scanned PDFs (images of pages) have no text layer and come back empty.
      const { text } = await extractText(pdf, { mergePages: false });
      chunks = chunkPages(text);
    } else {
      chunks = chunkText(await file.text()).map((content) => ({ content, page: null }));
    }
    if (!chunks.length) return Response.json({ error: "No text found in file" }, { status: 400 });

    // 2. Embed every chunk (Voyage API), then 3. store text + vectors (Postgres). This is the
    // slow part of an upload: hundreds of chunks means many embedding requests.
    const embeddings = await embedDocuments(chunks.map((c) => c.content));
    const id = await addDocument(name, chunks, embeddings);
    return Response.json({ id, name, chunks: chunks.length });
  } catch (e) {
    console.error(e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
