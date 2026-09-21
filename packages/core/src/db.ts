// STORAGE AND SEARCH
// Postgres with the pgvector extension stores each chunk's embedding in a `vector` column and
// can find the stored vectors nearest to a given one. That nearest-neighbor query is the
// "retrieval" step of RAG.

import pg from "pg";
import pgvector from "pgvector/pg";
import { EMBED_DIM } from "./embed.ts";
import type { Chunk } from "./chunk.ts";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon URLs carry ?sslmode=require, which pg honors on its own. This line covers Render's
  // external Postgres URLs, which need SSL; internal URLs and localhost don't.
  ssl: process.env.DATABASE_URL?.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

// Runs on every new pooled connection. Teaches node-postgres how to convert between JS arrays
// and the `vector` type. This only works once the extension exists (see initSchema).
pool.on("connect", async (client) => {
  await pgvector.registerTypes(client);
});

/** Runs at startup. Idempotent, so it's safe to run on every boot. */
export async function initSchema() {
  // Create the extension over a plain client, not the pool: every pooled connection calls
  // registerTypes, which fails until the vector type exists. Chicken-and-egg otherwise.
  const c = new pg.Client(pool.options);
  await c.connect();
  try {
    await c.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await c.end();
  }
  // Two tables: one row per book, and many chunk rows per book. ON DELETE CASCADE means
  // deleting a book removes its chunks automatically.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id SERIAL PRIMARY KEY,
      document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      idx INT NOT NULL,
      page INT,
      content TEXT NOT NULL,
      embedding vector(${EMBED_DIM}) NOT NULL -- must match the embedding model's output size
    );
    ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page INT;
    -- HNSW is an approximate nearest-neighbor index: it makes similarity search fast on large
    -- tables by not checking every row. vector_cosine_ops matches the <=> operator used below.
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
  `);
}

/**
 * Saves one book and all its chunks. Runs in a transaction, so a failure midway (say, a
 * dropped connection) leaves nothing half-saved and retrying the upload can't create duplicates.
 * `embeddings[i]` is the vector for `chunks[i]`.
 */
export async function addDocument(name: string, chunks: Chunk[], embeddings: number[][]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("INSERT INTO documents (name) VALUES ($1) RETURNING id", [name]);
    const docId = rows[0].id as number;
    // Insert 100 rows per query instead of one at a time. A book is ~1,000 chunks, and a network
    // round trip per row to a remote database (Neon) would be very slow.
    const BATCH = 100;
    for (let start = 0; start < chunks.length; start += BATCH) {
      const slice = chunks.slice(start, start + BATCH);
      const params: unknown[] = [];
      const values = slice.map((c, j) => {
        const i = start + j;
        // pgvector.toSql converts a JS number[] into Postgres's vector text format.
        params.push(docId, i, c.page, c.content, pgvector.toSql(embeddings[i]));
        const b = j * 5;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
      });
      await client.query(
        `INSERT INTO chunks (document_id, idx, page, content, embedding) VALUES ${values.join(",")}`,
        params,
      );
    }
    await client.query("COMMIT");
    return docId;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** One retrieved chunk. `score` is cosine similarity: closer to 1 means more similar. */
export interface Hit {
  document: string;
  page: number | null;
  idx: number;
  content: string;
  score: number;
}

export interface SearchOptions {
  /** Total number of chunks to return. */
  k?: number;
  /** Restrict to these documents. */
  documentIds?: number[];
  /** If set, take the top N per document first, so no single book dominates. */
  perDocument?: number;
}

/**
 * The retrieval step. Takes the embedded question and returns the chunks whose vectors are
 * closest to it.
 *
 * `<=>` is pgvector's cosine-distance operator (0 = identical direction, 2 = opposite), so
 * ORDER BY distance ascending gives the most similar chunks first. `1 - distance` turns that
 * into a similarity score for display.
 */
export async function search(queryEmbedding: number[], opts: SearchOptions = {}): Promise<Hit[]> {
  const { k = 8, documentIds, perDocument } = opts;
  const vec = pgvector.toSql(queryEmbedding);
  const filter = documentIds?.length ? "WHERE c.document_id = ANY($3::int[])" : "";
  const params: unknown[] = [vec, k];
  if (documentIds?.length) params.push(documentIds);

  let sql: string;
  if (perDocument) {
    // Balanced mode: rank chunks within each book (row_number per document_id), keep only the
    // top N from each, then rank the survivors together. This stops one book's phrasing from
    // taking every slot when you want to compare authors.
    params.push(perDocument);
    const n = params.length;
    sql = `SELECT * FROM (
             SELECT d.name AS document, c.page, c.idx, c.content, 1 - (c.embedding <=> $1) AS score,
                    row_number() OVER (PARTITION BY c.document_id ORDER BY c.embedding <=> $1) AS rn
             FROM chunks c JOIN documents d ON d.id = c.document_id ${filter}
           ) t WHERE rn <= $${n} ORDER BY score DESC LIMIT $2`;
  } else {
    // Plain mode: the k nearest chunks across everything selected.
    sql = `SELECT d.name AS document, c.page, c.idx, c.content, 1 - (c.embedding <=> $1) AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id ${filter}
           ORDER BY c.embedding <=> $1 LIMIT $2`;
  }
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function listDocuments() {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.created_at, count(c.id)::int AS chunks
     FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
     GROUP BY d.id ORDER BY d.created_at DESC`,
  );
  return rows as { id: number; name: string; created_at: string; chunks: number }[];
}

export async function deleteDocument(id: number) {
  await pool.query("DELETE FROM documents WHERE id = $1", [id]);
}
