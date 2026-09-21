// The web server: serves the single-page UI and exposes the JSON/SSE API behind it.
//
// The whole RAG flow lives in two routes:
//   POST /api/upload  ingest: extract text -> chunk -> embed -> store
//   POST /api/chat    query:  embed question -> retrieve nearest chunks -> Claude answers

import express from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";
import {
  addDocument, answerWithSources, chunkPages, chunkText, deleteDocument, embedDocuments,
  embedQuery, initSchema, type Chunk, listDocuments, search,
} from "@ai-apps/core";

const app = express();
// Uploads are held in memory (fine for a few 10-50 MB PDFs) rather than written to disk.
// Render's disk is ephemeral anyway. The cap protects the server from huge files.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");

// Health check for Render. Registered BEFORE the password check so Render's monitor can reach it.
app.get("/healthz", (_req, res) => res.send("ok"));

// ---- Password protection --------------------------------------------------------------------
// One shared password, using HTTP Basic auth: the browser shows its own login prompt and then
// automatically re-sends the credentials on every request, including fetch() calls, uploads, and
// the streaming chat. The username is ignored; only the password matters.
//
// This gates the whole app, so it also protects your API credits: every chat and upload spends
// money at Anthropic and Voyage. Anyone with the password can do that, so hand it out
// deliberately, and set spend limits in both dashboards.
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  // Render sets RENDER=true. Refuse to boot there without a password, so a forgotten env var
  // can't leave your books and API keys open to the internet.
  if (process.env.RENDER) throw new Error("APP_PASSWORD must be set in production");
  console.warn("APP_PASSWORD is not set: the app is open to anyone who can reach it (fine on localhost).");
}

/** Compares in constant time so response timing can't leak how much of a guess was correct.
 *  Hashing first gives both sides equal length, which timingSafeEqual requires. */
function passwordMatches(given: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(APP_PASSWORD!).digest();
  return crypto.timingSafeEqual(a, b);
}

if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      // Basic auth is "username:password". Take everything after the first colon.
      if (passwordMatches(decoded.slice(decoded.indexOf(":") + 1))) return next();
    }
    // The WWW-Authenticate header is what makes the browser pop up its login dialog.
    res.set("WWW-Authenticate", 'Basic realm="RAG Chat", charset="UTF-8"').status(401).send("Password required");
  });
}

app.use(express.json());
app.use(express.static(publicDir)); // serves public/index.html at "/"

app.get("/api/documents", async (_req, res) => {
  res.json(await listDocuments());
});

// ---- Ingest: upload a book ------------------------------------------------------------------
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const name = file.originalname.replace(/\.(pdf|txt|md)$/i, "");

    // 1. Extract text and chunk it.
    let chunks: Chunk[];
    if (/\.pdf$/i.test(file.originalname)) {
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      // mergePages:false returns one string per page, which is how each chunk gets a page number.
      // Scanned PDFs (images of pages) have no text layer and come back empty.
      const { text } = await extractText(pdf, { mergePages: false });
      chunks = chunkPages(text);
    } else {
      chunks = chunkText(file.buffer.toString("utf8")).map((content) => ({ content, page: null }));
    }
    if (!chunks.length) return res.status(400).json({ error: "No text found in file" });

    // 2. Embed every chunk (Voyage API), then 3. store text + vectors (Postgres). This is the
    // slow part of an upload: hundreds of chunks means many embedding requests.
    const embeddings = await embedDocuments(chunks.map((c) => c.content));
    const id = await addDocument(name, chunks, embeddings);
    res.json({ id, name, chunks: chunks.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete("/api/documents/:id", async (req, res) => {
  await deleteDocument(Number(req.params.id));
  res.status(204).end();
});

// ---- Query: ask a question ------------------------------------------------------------------
// Responds with Server-Sent Events (SSE), a long-lived response that pushes named events to the
// browser as they happen:  `sources` once, then many `delta` (answer text pieces), then `done`.
// Sending sources first lets the UI show what was retrieved while Claude is still writing.
app.post("/api/chat", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "question is required" });

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  // SSE wire format: "event: <name>\ndata: <json>\n\n". The blank line ends one event.
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // The UI sends which books are ticked and whether "Balance across books" is on.
    const documentIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds.map(Number) : undefined;
    const balanced = Boolean(req.body?.balanced);

    // RETRIEVE: embed the question with the same model used for the chunks, then ask Postgres for
    // the nearest ones. k=10 gives Claude enough context for questions that span several places.
    const hits = await search(await embedQuery(question), {
      k: 10,
      documentIds,
      perDocument: balanced ? 4 : undefined,
    });
    send("sources", hits.map((h, i) => ({ n: i + 1, document: h.document, page: h.page, score: h.score, content: h.content })));

    // GENERATE: Claude answers from those chunks only, and each piece of text is forwarded to
    // the browser the moment it arrives.
    if (!hits.length) {
      send("delta", "No documents have been uploaded yet.");
    } else {
      await answerWithSources(question, hits, (t) => send("delta", t));
    }
    send("done", {});
  } catch (e) {
    console.error(e);
    // Headers are already sent (we're streaming), so we can't change the HTTP status; report
    // the failure as an event instead.
    send("error", (e as Error).message);
  } finally {
    res.end();
  }
});

const port = Number(process.env.PORT ?? 3000); // Render tells us which port to use via PORT
await initSchema(); // make sure the tables and vector index exist before accepting traffic
app.listen(port, () => console.log(`rag-chat listening on :${port}`));
