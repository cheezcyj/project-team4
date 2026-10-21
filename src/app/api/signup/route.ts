import { apiRoute, jsonBody } from "@/lib/server/http";
import { signup } from "@/lib/server/account";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return apiRoute(request, async () => signup(request, await jsonBody(request)), true);
}
