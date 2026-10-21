import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { ApiError } from "../errors";
import { DEMO_USERS, DemoStore } from "../demo-store";

export const COOKIE_NAME = "glucose_demo_session";
export const SESSION_SECONDS = 8 * 60 * 60;
type DemoAccount = keyof typeof DEMO_USERS;
type SessionPayload = { account: DemoAccount; expires: number };

// 시연 계정은 공개 서버에서 사용할 수 없도록 요청 주소를 먼저 확인해요.
export function assertLocalDemo(request: Request): void {
  let hostname: string;
  try {
    hostname = new URL(`http://${request.headers.get("host") ?? ""}`).hostname;
  } catch {
    throw new ApiError(403, "LOCAL_ONLY", "시연 모드는 이 컴퓨터에서만 사용할 수 있어요.");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new ApiError(403, "LOCAL_ONLY", "시연 모드는 이 컴퓨터에서만 사용할 수 있어요.");
  }
}

export function demoSecret(): string {
  const secret = process.env.DEMO_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(503, "DEMO_NOT_CONFIGURED", "시연 실행 명령으로 서버를 시작해 주세요.");
  }
  return secret;
}

// 내용은 암호화하지 않아요. 서명은 계정 번호나 만료 시각이 바뀌었는지 확인하는 용도예요.
export function signDemoSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function parseDemoSession(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const segments = token.split(".");
  if (segments.length !== 2) return null;
  const [body, supplied] = segments;
  const expected = createHmac("sha256", secret).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(supplied, "base64url");
  } catch {
    return null;
  }
  // 같은 길이의 서명을 일정한 방식으로 비교한 뒤에만 안쪽 내용을 읽어요.
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (
      !["a", "b"].includes(payload.account) ||
      !Number.isFinite(payload.expires) ||
      payload.expires <= now ||
      payload.expires > now + SESSION_SECONDS * 1000 + 10_000
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function demoStore(): DemoStore {
  const workspaceRoot = process.env.DEMO_WORKSPACE_ROOT || process.cwd();
  const defaultPath = path.join(/* turbopackIgnore: true */ workspaceRoot, ".local", "demo-data.json");
  const configured = process.env.DEMO_DATA_FILE;
  if (!configured) return new DemoStore(defaultPath);
  const filename = path.resolve(/* turbopackIgnore: true */ workspaceRoot, configured);
  const localRoot = path.resolve(/* turbopackIgnore: true */ workspaceRoot, ".local");
  const relative = path.relative(localRoot, filename);
  // 설정한 경로가 .local 밖으로 벗어나 다른 작업 파일을 덮어쓰지 않게 제한해요.
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(503, "DEMO_NOT_CONFIGURED", "시연 데이터 설정을 확인해 주세요.");
  }
  return new DemoStore(filename);
}
