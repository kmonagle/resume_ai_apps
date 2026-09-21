// NEXT.JS: app/healthz/route.ts is served at /healthz. (A folder without page.tsx but with
// route.ts is an endpoint, not a page.)
// Health check for Render. Not password protected (see the proxy matcher).
export function GET() {
  return new Response("ok");
}
