import { apiRoute, jsonBody } from "@/lib/server/http";
import { getRecord, removeRecord, updateRecord } from "@/lib/server/records";
import { requestContext } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return apiRoute(request, async () => ({
    record: await getRecord(await requestContext(request), (await params).id),
  }));
}
export async function PATCH(request: Request, { params }: Params) {
  return apiRoute(request, async () => ({
    record: await updateRecord(await requestContext(request), (await params).id, await jsonBody(request)),
  }), true);
}
export async function DELETE(request: Request, { params }: Params) {
  return apiRoute(request, async () => {
    await removeRecord(await requestContext(request), (await params).id);
    return { ok: true };
  }, true);
}
