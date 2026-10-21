import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isProjectAuthCookie, signupFields } from "../account-validation";
import { ApiError } from "./errors";
import { appMode, requestContext, supabaseClient } from "./session";
import { readSupabaseSettings } from "./supabase-settings";

export async function signup(request: Request, body: Record<string, unknown>) {
  if (appMode() !== "supabase") throw new ApiError(503, "SIGNUP_UNAVAILABLE", "현재 화면에서는 회원가입을 사용할 수 없어요.");
  const errors = signupFields(body);
  if (Object.keys(errors).length) throw new ApiError(422, "INVALID_INPUT", "입력한 내용을 확인해 주세요.", errors);
  const supabase = await supabaseClient();
  if ((await supabase.auth.getUser()).data.user) throw new ApiError(409, "ALREADY_SIGNED_IN", "다른 계정을 만들려면 먼저 로그아웃해 주세요.");
  const { data, error } = await supabase.auth.signUp({ email: (body.email as string).trim(), password: body.password as string });
  if (error) {
    if (error.status === 429) throw new ApiError(429, "AUTH_RATE_LIMIT", "가입 요청이 많아요. 잠시 후 다시 시도해 주세요.");
    if (error.code === "signup_disabled") throw new ApiError(503, "SIGNUP_UNAVAILABLE", "회원가입을 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
    if (error.code === "weak_password") throw new ApiError(422, "INVALID_INPUT", "다른 비밀번호를 사용해 주세요.", { password: "추측하기 어려운 비밀번호를 입력해 주세요." });
    if (error.status && error.status >= 500) throw new ApiError(503, "AUTH_UNAVAILABLE", "가입 결과를 확인하지 못했어요. 로그인 화면에서 먼저 확인해 주세요.");
    // 특정 이메일의 가입 여부가 드러나지 않도록 같은 안내를 보내요.
    throw new ApiError(422, "SIGNUP_FAILED", "가입을 완료하지 못했어요. 입력 내용을 확인하거나 기존 계정으로 로그인해 주세요.");
  }
  if (!data.session) return { status: "confirmation_required" as const };
  return { status: "signed_in" as const, session: (await requestContext(request)).session };
}

export async function deleteAccount(request: Request, body: Record<string, unknown>) {
  const context = await requestContext(request);
  if (context.session.mode !== "supabase") throw new ApiError(403, "DEMO_ACCOUNT", "가상 계정은 탈퇴할 수 없어요.");
  if (body.confirmation !== "탈퇴" || typeof body.password !== "string" || !body.password || body.password.length > 256) {
    throw new ApiError(422, "INVALID_INPUT", "현재 비밀번호와 ‘탈퇴’를 입력해 주세요.");
  }
  const settings = readSupabaseSettings(process.env)!;
  // 현재 비밀번호를 별도 연결에서 다시 확인해요. 브라우저의 기존 로그인은 바꾸지 않아요.
  // 삭제 함수에는 방금 본인 확인을 마친 계정의 권한만 전달해요.
  const fresh = createClient(settings.url, settings.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const result = await fresh.auth.signInWithPassword({ email: context.session.user!.email, password: body.password });
  if (result.error) {
    if (result.error.status === 429) throw new ApiError(429, "AUTH_RATE_LIMIT", "요청이 많아요. 잠시 후 다시 시도해 주세요.");
    if (result.error.status && result.error.status >= 500) throw new ApiError(503, "AUTH_UNAVAILABLE", "본인 확인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
    throw new ApiError(422, "PASSWORD_MISMATCH", "현재 비밀번호를 확인해 주세요.", { password: "비밀번호가 맞지 않아요." });
  }
  try {
    // 재확인된 계정과 현재 화면의 계정이 같을 때만 본인 탈퇴를 진행해요.
    if (result.data.user.id !== context.session.user!.id) throw new ApiError(403, "ACCOUNT_MISMATCH", "계정이 바뀌었어요. 다시 로그인해 주세요.");
    const deleted = await fresh.rpc("delete_my_account");
    if (deleted.error) throw new ApiError(503, "DELETE_UNCONFIRMED", "탈퇴 완료를 확인하지 못했어요. 계정 상태를 다시 확인해 주세요.");
  } finally {
    // 성공하면 DB가 로그인 정보를 지워요. 실패한 경우에도 재확인용 로그인은 정리해요.
    await fresh.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  const jar = await cookies();
  // 같은 브라우저의 다른 서비스 쿠키는 남기고 이 Supabase 프로젝트의 쿠키만 지워요.
  for (const cookie of jar.getAll()) {
    if (isProjectAuthCookie(cookie.name, settings.url)) {
      jar.set(cookie.name, "", { path: "/", maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    }
  }
  return { ok: true };
}
