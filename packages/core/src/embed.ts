// EMBEDDINGS
// An embedding model turns text into a vector (a list of numbers) such that texts with similar
// meaning get nearby vectors. We call Voyage AI's hosted model over HTTPS. Claude doesn't offer
// an embedding model. Postgres never talks to Voyage; it only stores the vectors we hand it.

const MODEL = "voyage-3.5";
/** voyage-3.5 returns 1024 numbers per text. The database column must match this exactly, and
 *  switching models means re-embedding every stored chunk. */
export const EMBED_DIM = 1024;

/**
 * `inputType` tells Voyage whether this text is a stored passage or a search question. The model
 * tunes the vector slightly for each role, which improves matching between questions and
 * passages. Always use "document" when storing and "query" when searching.
 */
async function voyage(input: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  let res: Response;
  // Retry on 429 (rate limited) with exponential backoff: 5s, 10s, 20s, 40s, 60s, 60s.
  // Accounts without billing set up get very low limits, so uploads can hit this.
  for (let attempt = 0; ; attempt++) {
    res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input, model: MODEL, input_type: inputType }),
    });
    if (res.status !== 429 || attempt >= 6) break;
    const wait = Math.min(60_000, 5_000 * 2 ** attempt);
    console.warn(`Voyage rate limited (429); retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  // Sort by `index` so vectors line up with the input order, whatever order the API returns.
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embeds chunks for storage. Sent in batches of 64 to stay under per-request size limits. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    out.push(...(await voyage(texts.slice(i, i + 64), "document")));
  }
  return out;
}

/** Embeds a user's question for searching. Must use the same model as the stored chunks. */
export async function embedQuery(text: string): Promise<number[]> {
  return (await voyage([text], "query"))[0];
}
