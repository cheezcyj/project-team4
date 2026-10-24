import { apiRoute, jsonBody } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";
import { createConversation, listConversations } from "@/lib/assistant/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiRoute(request, async () => listConversations(await requestContext(request)));
}
export async function POST(request: Request) {
  return apiRoute(request, async () => ({ room: await createConversation(await requestContext(request), await jsonBody(request)) }), true, 201);
}
