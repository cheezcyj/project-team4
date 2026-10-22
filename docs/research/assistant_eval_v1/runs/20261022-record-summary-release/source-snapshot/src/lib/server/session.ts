import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { POLICY_VERSION, type AppSession } from "../domain";
import { ApiError, unauthorized } from "./errors";
import { DEMO_USERS, DemoStore } from "./demo-store";
import { readSupabaseSettings } from "./supabase-settings";

import {
  COOKIE_NAME,
  SESSION_SECONDS,
  assertLocalDemo,
  demoSecret,
  demoStore,
  parseDemoSession,
  signDemoSession,
} from "./session/demo";
import { supabaseClient } from "./session/supabase";

// API와 테스트는 기존 경로를 그대로 사용하고, 방식별 세부 처리는 하위 폴더에서 관리해요.
export { assertLocalDemo, demoStore, parseDemoSession, signDemoSession } from "./session/demo";
export { supabaseClient } from "./session/supabase";

export function appMode(): AppSession["mode"] {
  if (process.env.APP_MODE === "demo") return "demo";
  if (process.env.APP_MODE !== "supabase") return "unconfigured";
  return readSupabaseSettings(process.env) ? "supabase" : "unconfigured";
}

export type RequestContext = {
  session: AppSession;
  store?: DemoStore;
  supabase?: SupabaseClient;
};

// 쿠키의 내용만 믿지 않고 로그인 상태를 확인한 뒤 본인 정보와 동의 상태를 묶어요.
export async function requestContext(request: Request, requireUser = true): Promise<RequestContext> {
  const mode = appMode();
  if (mode === "unconfigured") {
    if (requireUser) throw new ApiError(503, "NOT_CONFIGURED", "서비스 연결을 준비하고 있어요.");
    return { session: { user: null, mode, consent: null } };
  }
  if (mode === "demo") {
    assertLocalDemo(request);
    const store = demoStore();
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const payload = token ? parseDemoSession(token, demoSecret()) : null;
    const user = payload ? DEMO_USERS[payload.account] : null;
    if (!user && requireUser) unauthorized();
    return {
      session: { user, mode, consent: user ? await store.consent(user.id) : null },
      store,
    };
  }
  const supabase = await supabaseClient();
  // getUser가 인증 서버에 실제 로그인 상태를 확인해요. 확인 전 쿠키 내용은 사용하지 않아요.
  const { data, error } = await supabase.auth.getUser();
  if (error && ((error.status && error.status >= 500) || error.name === "AuthRetryableFetchError")) {
    throw new ApiError(503, "AUTH_UNAVAILABLE", "로그인 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.");
  }
  const user = data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  if (!user && requireUser) unauthorized();
  if (!user) return { session: { user, mode, consent: null }, supabase };
  const consent = await supabase
    .from("user_consents")
    .select("policy_version")
    .eq("user_id", user.id)
    .maybeSingle();
  if (consent.error) throw new ApiError(503, "DATA_UNAVAILABLE", "동의 상태를 불러오지 못했어요.");
  return {
    session: {
      user,
      mode,
      consent: !consent.data ? "missing" : consent.data.policy_version === POLICY_VERSION ? "current" : "outdated",
    },
    supabase,
  };
}

// 시연 로그인과 실제 회원 로그인을 구분하되, 성공 후에는 같은 로그인 정보 형태를 돌려줘요.
export async function login(request: Request, body: Record<string, unknown>): Promise<AppSession> {
  if (appMode() === "demo") {
    assertLocalDemo(request);
    if (body.demoAccount !== "a" && body.demoAccount !== "b") {
      throw new ApiError(422, "INVALID_INPUT", "시연 계정을 선택해 주세요.");
    }
    const account = body.demoAccount;
    const token = signDemoSession({ account, expires: Date.now() + SESSION_SECONDS * 1000 }, demoSecret());
    (await cookies()).set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    return {
      user: DEMO_USERS[account],
      mode: "demo",
      consent: await demoStore().consent(DEMO_USERS[account].id),
    };
  }
  if (appMode() !== "supabase") throw new ApiError(503, "NOT_CONFIGURED", "서비스 연결을 준비하고 있어요.");
  if (
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    typeof body.password !== "string" ||
    body.password.length < 1 ||
    body.password.length > 256
  ) {
    throw new ApiError(422, "INVALID_INPUT", "이메일과 비밀번호를 입력해 주세요.");
  }
  const supabase = await supabaseClient();
  const result = await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
  if (result.error) {
    if ((result.error.status && result.error.status >= 500) || result.error.name === "AuthRetryableFetchError") {
      throw new ApiError(503, "AUTH_UNAVAILABLE", "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    throw new ApiError(401, "LOGIN_FAILED", "이메일과 비밀번호를 확인해 주세요.");
  }
  return (await requestContext(request)).session;
}

export async function logout(request: Request): Promise<void> {
  if (appMode() === "demo") {
    assertLocalDemo(request);
    (await cookies()).set(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "strict" });
    return;
  }
  if (appMode() !== "supabase") return;
  const supabase = await supabaseClient();
  // 현재 브라우저의 로그인만 끝내고 다른 기기의 로그인은 유지해요.
  const result = await supabase.auth.signOut({ scope: "local" });
  if (result.error) throw new ApiError(503, "LOGOUT_FAILED", "로그아웃 결과를 확인하지 못했어요. 다시 시도해 주세요.");
}
