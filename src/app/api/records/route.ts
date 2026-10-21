import { apiRoute, jsonBody } from "@/lib/server/http";
import { insertRecord, listRecords } from "@/lib/server/records";
import { requestContext } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주소에서 조회 날짜만 받고, 기록 소유자는 서버가 확인한 로그인 정보로 정해요.
export async function GET(request: Request) {
  return apiRoute(request, async () =>
    listRecords(await requestContext(request), Object.fromEntries(new URL(request.url).searchParams)),
  );
}
export async function POST(request: Request) {
  return apiRoute(request, async () => ({
    record: await insertRecord(await requestContext(request), await jsonBody(request)),
  }), true, 201);
}
