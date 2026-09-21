// NEXT.JS: instrumentation.ts is a special file. Its exported `register()` function runs ONCE when
// the server process boots (not per request), which makes it the right place for startup work
// like checking configuration and preparing the database.
// Runs once when the Next.js server starts (not per request).
export async function register() {
  // Next can run code in several runtimes (Node, Edge). We only want the Node one, where pg works.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!process.env.APP_PASSWORD) {
    // Render sets RENDER=true. Refuse to boot there without a password, so a forgotten env var
    // can't leave your books and API keys open to the internet.
    if (process.env.RENDER) throw new Error("APP_PASSWORD must be set in production");
    console.warn("APP_PASSWORD is not set: the app is open to anyone who can reach it (fine on localhost).");
  }

  // Make sure the tables and vector index exist before serving traffic.
  // Imported here (not at the top) so this file stays safe to load in non-Node runtimes.
  const { initSchema } = await import("@ai-apps/core");
  await initSchema();
}
