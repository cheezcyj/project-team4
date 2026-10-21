import { apiRoute, jsonBody } from "@/lib/server/http";
import { agree } from "@/lib/server/records";
import { requestContext } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return apiRoute(request, async () => {
    await agree(await requestContext(request), await jsonBody(request));
    return { ok: true };
  }, true);
}
