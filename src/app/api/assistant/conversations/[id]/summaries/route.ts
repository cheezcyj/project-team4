import { apiRoute, jsonBody } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";
import { sendSummaryTurn } from "@/lib/assistant/conversation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return apiRoute(request, async () => ({ room: await sendSummaryTurn(await requestContext(request), (await route.params).id, await jsonBody(request),
    { signal: request.signal, revalidate: () => requestContext(request) }) }), true);
}
