import { apiRoute, jsonBody } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";
import { answerQuestion, assistantStatus } from "@/lib/assistant/service";
import { isLoopbackAssistantRequest } from "@/lib/assistant/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(request, async () => assistantStatus(await requestContext(request), process.env,
    { loopbackRequest: isLoopbackAssistantRequest(request) }));
}

export async function POST(request: Request) {
  return apiRoute(request, async () => answerQuestion(await requestContext(request), await jsonBody(request),
    { signal: request.signal, loopbackRequest: isLoopbackAssistantRequest(request) }), true);
}
