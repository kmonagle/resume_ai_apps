// PASSWORD PROTECTION
// One shared password using HTTP Basic auth: the browser shows its own login prompt, then
// re-sends the credentials on every same-origin request (including fetch and uploads). The
// username is ignored; only the password matters.
//
// This gates the whole app, and protects your API credits: every chat and upload spends money
// at Anthropic and Voyage, so hand the password out deliberately.
//
// Defense in depth: Next's proxy (proxy.ts) checks pages, and EVERY API route handler calls
// requireAuth() again. Next's own docs say the proxy isn't a security boundary, and it also
// can't cover /api/upload (it buffers request bodies), so the handlers do the real enforcement.

// `lib/` is just a convention for shared helper code; Next treats it like any other folder.
// The "@/" import alias (set in tsconfig.json) means "from the project root", so
// import { requireAuth } from "@/lib/auth" works from any depth.
import crypto from "node:crypto";

/** Compares in constant time so response timing can't leak how much of a guess was correct.
 *  Hashing first gives both sides equal length, which timingSafeEqual requires. */
function passwordMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Returns a 401 Response if the request lacks the right password, or null if it may proceed. */
export function requireAuth(req: Request): Response | null {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return null; // no password configured (localhost only; instrumentation.ts blocks this on Render)

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    // Basic auth is "username:password". Take everything after the first colon.
    if (passwordMatches(decoded.slice(decoded.indexOf(":") + 1), expected)) return null;
  }
  // The WWW-Authenticate header is what makes the browser pop up its login dialog.
  return new Response("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="RAG Chat", charset="UTF-8"' },
  });
}
