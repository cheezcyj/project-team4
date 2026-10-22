"use client";
export class RequestError extends Error {
  constructor(message: string, public code: string, public status: number, public fields?: Record<string, string>) {
    super(message);
  }
}
// 같은 탭에서 보낸 로그인 변경 알림을 다시 처리하지 않도록 구분해요.
export const sessionSignalSender = typeof window === "undefined" ? "" : crypto.randomUUID();
function invalidateRecordSummary() {
  window.dispatchEvent(new Event("glucose-records-changed"));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("glucose-records");
    channel.postMessage({ type: "changed" }); channel.close();
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // 응답이 끊겨도 서버에는 저장됐을 수 있어요. 결과를 모르면 자동 재전송하지 않아요.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const changesRecords = /^(?:POST|PUT|PATCH|DELETE)$/i.test(init?.method ?? "GET") && /^\/api\/(?:records|imports|consent)(?:\/|$|\?)/.test(url);
  if (changesRecords) invalidateRecordSummary();
  try {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { "Content-Type": "application/json", ...init?.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && url !== "/api/login")
        window.dispatchEvent(new Event("app-session-expired"));
      throw new RequestError(body?.error || "요청을 완료하지 못했어요. 잠시 후 다시 확인해 주세요.", body?.code || "REQUEST_FAILED", response.status, body?.fields);
    }
    if (!body)
      throw new RequestError("결과를 확인할 수 없어요. 다시 확인해 주세요.", "UNKNOWN_OUTCOME", 503);
    // 다른 탭에도 로그인·로그아웃·탈퇴 사실을 알려 계정 상태를 다시 확인하게 해요.
    if (["/api/login", "/api/logout", "/api/signup", "/api/account"].includes(url) && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("glucose-session");
      channel.postMessage({ sender: sessionSignalSender, type: "changed" });
      channel.close();
    }
    return body as T;
  }
  catch (error) {
    if (error instanceof RequestError)
      throw error;
    throw new RequestError("연결이 끊어져 결과를 확인하지 못했어요.", "UNKNOWN_OUTCOME", 503);
  }
  finally {
    clearTimeout(timer);
    // 응답을 놓쳐도 서버가 바뀌었을 수 있어요. 요청 전과 완료 후 모두 이전 요약을 무효화해요.
    if (changesRecords) invalidateRecordSummary();
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 완료하지 못했어요.";
}
