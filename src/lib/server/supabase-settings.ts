export type SupabaseSettings = { url: string; publishableKey: string };

/** 서버를 실행할 때 연결 설정을 읽어요. 브라우저 빌드에 연결 값을 고정하지 않아요. */
export function readSupabaseSettings(env: Record<string, string | undefined>): SupabaseSettings | null {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    // 공개용 키만 받아 관리자 권한이 사용자의 기록 조회에 섞이지 않게 해요.
    if (!publishableKey.startsWith("sb_publishable_")) {
      const parts = publishableKey.split(".");
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role !== "anon") return null;
    }
    return { url: url.replace(/\/$/, ""), publishableKey };
  } catch {
    return null;
  }
}
