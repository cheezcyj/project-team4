import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 웹 서버의 응답 여부만 확인해요. DB·로그인 연결까지 정상이라는 뜻은 아니에요.
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
