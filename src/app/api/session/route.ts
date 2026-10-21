import { apiRoute } from "@/lib/server/http";
import { requestContext } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 로그인 전 화면도 호출하므로, 비회원은 오류 대신 user: null 상태를 받아요.
export async function GET(request: Request) {
  return apiRoute(request, async () => (await requestContext(request, false)).session);
}
