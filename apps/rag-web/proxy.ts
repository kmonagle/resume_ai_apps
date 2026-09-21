// NEXT.JS: proxy.ts (called middleware.ts before Next 16) is a special file. Next runs it BEFORE a
// request reaches any page or route, so it's the place for redirects, header tweaks, and auth
// gates. It must sit at the project root (next to /app) and export a `proxy` function.
// Next.js 16 "proxy" (formerly middleware): runs before pages are served. Here it puts the
// password prompt in front of the UI. API routes re-check on their own (see lib/auth.ts).
import { requireAuth } from "./lib/auth";
import { NextResponse } from "next/server";

export function proxy(req: Request) {
  return requireAuth(req) ?? NextResponse.next();
}

export const config = {
  // `matcher` lists which URL paths the proxy applies to (a regex-like pattern; the leading (?!...)
  // means "everything EXCEPT these").
  // Skip: /healthz (Render's health check), /api/* (handlers authenticate themselves; the proxy
  // would also buffer and cap upload bodies), and Next's static assets.
  matcher: ["/((?!healthz|api/|_next/).*)"],
};
