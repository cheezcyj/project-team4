import { apiRoute, jsonBody } from "@/lib/server/http";
import { login } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return apiRoute(request, async () => login(request, await jsonBody(request)), true);
}
