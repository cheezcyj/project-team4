import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../errors";
import { readSupabaseSettings } from "../supabase-settings";

// 요청마다 새 연결을 만들고 해당 사용자의 쿠키만 연결해요. 관리자용 키는 쓰지 않아요.
export async function supabaseClient(): Promise<SupabaseClient> {
  const settings = readSupabaseSettings(process.env);
  if (!settings) throw new ApiError(503, "NOT_CONFIGURED", "서비스 연결을 준비하고 있어요.");
  const jar = await cookies();
  return createServerClient(settings.url, settings.publishableKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          jar.set(name, value, {
            ...options,
            // 화면의 스크립트가 로그인 쿠키를 읽지 못하게 하고, 배포 환경에서는 HTTPS로만 보내요.
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }
      },
    },
    // 사용자별 인증·조회 결과를 다음 요청의 캐시로 재사용하지 않아요.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
