import { listDocuments } from "@ai-apps/core";
import { requireAuth } from "@/lib/auth";

// NEXT.JS: this file is the endpoint /api/documents (file path = URL path). GET handlers can be
// cached by Next unless told otherwise, and our list changes on every upload or delete.
export const dynamic = "force-dynamic"; // never cache: the list changes on upload/delete

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  return Response.json(await listDocuments());
}
