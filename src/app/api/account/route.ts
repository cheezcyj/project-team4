import { apiRoute, jsonBody } from "@/lib/server/http";
import { deleteAccount } from "@/lib/server/account";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request) {
  return apiRoute(request, async () => deleteAccount(request, await jsonBody(request)), true);
}
