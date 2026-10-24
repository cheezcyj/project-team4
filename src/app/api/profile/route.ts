import { apiRoute, jsonBody } from "@/lib/server/http";
import { getHealthProfile, removeHealthProfile, saveHealthProfile } from "@/lib/server/health-profile";
import { requestContext } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(request, async () => ({ profile: await getHealthProfile(await requestContext(request)) }));
}

export async function PUT(request: Request) {
  return apiRoute(request, async () => ({
    profile: await saveHealthProfile(await requestContext(request), await jsonBody(request)),
  }), true);
}

export async function DELETE(request: Request) {
  return apiRoute(request, async () => {
    await removeHealthProfile(await requestContext(request), await jsonBody(request));
    return { ok: true };
  }, true);
}
