import type { RequestContext } from "../server/session";
import type { AssistantEnvironment } from "./model";

// 전달받은 proxy 헤더로 평가 권한을 만들지 않고 실제 요청 주소·Host를 함께 확인해요.
export function isLoopbackAssistantRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const rawHost = request.headers.get("host");
    if (!rawHost) return false;
    const host = new URL(`${url.protocol}//${rawHost}`);
    const loopback = (hostname: string) => ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
    // Next.js는 내부 URL을 localhost로 정규화할 수 있어요. 두 호스트 모두 loopback이고 포트가 같아야 해요.
    if (!["http:", "https:"].includes(url.protocol) || !loopback(url.hostname) || !loopback(host.hostname)
      || host.host.toLowerCase() !== rawHost.toLowerCase() || host.port !== url.port
      || request.headers.get("sec-fetch-site") === "cross-site") return false;
    const origin = request.headers.get("origin");
    return !origin || new URL(origin).origin === host.origin;
  } catch { return false; }
}

export function draftPreviewAllowed(context: RequestContext, env: AssistantEnvironment, loopbackRequest = false): boolean {
  if (env.ASSISTANT_ALLOW_DRAFT_PREVIEW !== "1") return false;
  if (context.session.mode === "demo") return true;
  const user = context.session.user;
  if (context.session.mode !== "supabase" || env.NODE_ENV !== "development" || !loopbackRequest
    || context.session.consent !== "current" || !user || !/@[^@\s]+\.invalid$/i.test(user.email)) return false;
  // 서버 설정으로 지정한 가상 계정만 허용해요. 요청 본문·URL로 계정을 추가할 수 없어요.
  const ids = (env.ASSISTANT_SUPABASE_EVAL_USER_IDS ?? "").split(",").map(value => value.trim().toLowerCase());
  return ids.some(id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) && id === user.id.toLowerCase());
}
