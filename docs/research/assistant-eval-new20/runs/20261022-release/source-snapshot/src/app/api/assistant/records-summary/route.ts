import { fastingRecordSummary } from "@/lib/assistant/record-summary";
import { apiRoute, jsonBody } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return apiRoute(request, async () => fastingRecordSummary(await requestContext(request), await jsonBody(request),
    { signal: request.signal, revalidate: () => requestContext(request) }), true);
}
