import { apiRoute, jsonBody } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";
import { sendConversationTurn } from "@/lib/assistant/conversation-service";
import { isLoopbackAssistantRequest } from "@/lib/assistant/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return apiRoute(request, async () => ({ room: await sendConversationTurn(await requestContext(request), (await route.params).id, await jsonBody(request),
    { loopbackRequest: isLoopbackAssistantRequest(request) }) }), true);
}
