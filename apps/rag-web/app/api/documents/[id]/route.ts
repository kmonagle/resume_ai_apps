// NEXT.JS: a folder name in square brackets is a dynamic URL segment. This file handles
// /api/documents/7, /api/documents/12, etc., and the value arrives as `params.id`.
import { deleteDocument } from "@ai-apps/core";
import { requireAuth } from "@/lib/auth";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await params; // in Next 15+, route params arrive as a Promise
  await deleteDocument(Number(id));
  return new Response(null, { status: 204 });
}
