import { apiRoute } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";
import { deleteConversation, getConversation } from "@/lib/assistant/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(request, async () => ({ room: await getConversation(await requestContext(request), (await route.params).id) }));
}
export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(request, async () => {
    await deleteConversation(await requestContext(request), (await route.params).id);
    return { ok: true };
  }, true);
}
