import { NextResponse } from "next/server";
import { ApiError } from "./errors";

const MAX_JSON_BYTES = 16_384;

// 로그인 정보와 개인 기록 응답은 브라우저·중간 서버의 캐시에 남기지 않아요.
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let valid = false;
  try {
    const parsed = new URL(origin ?? "");
    valid = (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
  } catch {
    valid = false;
  }
  // 다른 사이트가 로그인 쿠키를 이용해 저장·삭제를 대신 요청하는 일을 막아요.
  if (!valid || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "ORIGIN_MISMATCH", "이 화면에서 요청을 확인하지 못했어요. 페이지를 새로 열어 주세요.");
  }
}

export async function jsonBody(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new ApiError(413, "BODY_TOO_LARGE", "입력 내용이 너무 길어요.");
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "INVALID_CONTENT_TYPE", "입력 형식을 확인해 주세요.");
  }
  try {
    // 요청에 적힌 용량은 없거나 틀릴 수 있어요. 실제 읽은 크기도 같은 한도로 제한해요.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", "입력 내용이 너무 길어요.");
      }
      chunks.push(result.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "입력 내용을 읽지 못했어요.");
  }
}

export async function apiRoute(
  request: Request,
  handler: () => Promise<unknown>,
  mutation = false,
  status = 200,
): Promise<NextResponse> {
  try {
    // 변경 요청의 출처 확인은 각 기능을 실행하기 전에 공통으로 처리해요.
    if (mutation) assertSameOrigin(request);
    const result = await handler();
    return NextResponse.json(result, { status, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }
    // 예상하지 못한 오류의 원문에는 개인 정보나 서버 경로가 있을 수 있어 화면에 보내지 않아요.
    return NextResponse.json(
      {
        error: mutation
          ? "요청 결과를 확인하지 못했어요. 현재 상태를 다시 확인해 주세요."
          : "정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        code: mutation ? "UNKNOWN_OUTCOME" : "SERVER_UNAVAILABLE",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
