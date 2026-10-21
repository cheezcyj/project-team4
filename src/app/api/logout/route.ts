import { apiRoute } from "@/lib/server/http";
import { logout } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return apiRoute(request, async () => {
    await logout(request);
    return { ok: true };
  }, true);
}
