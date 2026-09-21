import path from "node:path";
import type { NextConfig } from "next";

// Local dev: the shared .env lives at the repo root, but Next only reads .env from this folder.
// Load it explicitly. Existing environment variables win, so on Render (where the real values
// are injected) this is a harmless no-op.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  /* no root .env file: fine */
}

// NEXT.JS: next.config.ts holds project-wide settings. Next reads it at startup, before anything else.
const config: NextConfig = {
  // Our shared package is plain TypeScript, so Next has to compile it as part of the app.
  transpilePackages: ["@ai-apps/core"],
  // These use Node APIs / native bits and should be loaded by Node at runtime, not bundled.
  serverExternalPackages: ["pg", "pgvector", "unpdf"],
};

export default config;
