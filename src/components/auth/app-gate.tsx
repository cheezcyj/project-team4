"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppSession } from "@/lib/domain";
import { api, errorMessage, sessionSignalSender } from "@/lib/client/api";
import { retainUserDrafts } from "@/lib/client/form-memory";
import { PublicFrame } from "@/components/layout/public-frame";
import { ErrorState, LoadingState } from "@/components/ui/page-parts";
const SessionContext = createContext<AppSession | null>(null);
export function useAppSession() {
  const session = useContext(SessionContext);
  if (!session)
    throw new Error("AppGate가 필요합니다.");
  return session;
}
export function AppGate({ children }: {
  children: ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const [session, setSession] = useState<AppSession | null>(null);
  const [error, setError] = useState("");
  const version = useRef(0);
  const invalidate = useCallback(() => { version.current += 1; }, []);
  const load = useCallback(async () => {
    // 늦게 도착한 이전 요청이 새 계정이나 새 화면의 상태를 덮어쓰지 못하게 해요.
    const requestVersion = ++version.current;
    setSession(null);
    setError("");
    try {
      const next = await api<AppSession>("/api/session");
      if (requestVersion !== version.current)
        return;
      if (!next.user) {
        router.replace(`/login?next=${encodeURIComponent(path)}`);
        return;
      }
      retainUserDrafts(next.user.id);
      setSession(next);
    }
    catch (cause) {
      if (requestVersion === version.current)
        setError(errorMessage(cause));
    }
  }, [path, router]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active)
        void load();
    });
    const expired = () => { ++version.current; setSession(null); router.replace(`/login?next=${encodeURIComponent(path)}`); };
    // 다른 탭에서 로그아웃했거나 뒤로 가기로 복원됐을 때도 다시 확인해요.
    const visibility = () => {
      if (document.visibilityState === "visible")
        void load();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted)
        void load();
    };
    window.addEventListener("app-session-expired", expired);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageshow);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glucose-session") : null;
    if (channel)
      channel.onmessage = event => {
        if (event.data?.type === "changed" && event.data.sender !== sessionSignalSender)
          void load();
      };
    return () => { active = false; invalidate(); channel?.close(); window.removeEventListener("app-session-expired", expired); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pageshow", pageshow); };
  }, [invalidate, load, path, router]);
  if (error)
    return <PublicFrame>
      <ErrorState message={error} retry={() => void load()} />
    </PublicFrame>;
  if (!session)
    return <PublicFrame>
      <LoadingState label="로그인 상태를 확인하는 중이에요." />
    </PublicFrame>;
  return <SessionContext.Provider value={session}>
    {children}
  </SessionContext.Provider>;
}
