"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AppSession } from "@/lib/domain";
import { api, errorMessage } from "@/lib/client/api";
import { retainUserDrafts } from "@/lib/client/form-memory";
import { PublicFrame } from "@/components/layout/public-frame";
import { InlineError, LoadingState } from "@/components/ui/page-parts";
export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<AppSession["mode"] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const goAfterLogin = useCallback((session: AppSession) => {
    if (!session.user)
      return;
    retainUserDrafts(session.user.id);
    const requested = params.get("next") || "";
    // 로그인 뒤 돌아갈 주소는 이 앱 안의 허용된 화면으로만 제한해요.
    const safe = /^\/(?:dashboard|consent|mypage|calendar|reports|comparison|imports|benefits|preferences|news|foods|records(?:\/new|\/[a-f0-9-]+\/edit)?|meals(?:\/new|\/[a-f0-9-]+\/edit)?)(?:\?|$)/.test(requested) ? requested : "/dashboard";
    router.replace(session.consent === "current" ? safe : "/consent");
    router.refresh();
  }, [params, router]);
  useEffect(() => {
    let active = true;
    api<AppSession>("/api/session").then(session => {
      if (active) {
        setMode(session.mode);
        if (session.user)
          goAfterLogin(session);
      }
    }).catch(cause => {
      if (active)
        setError(errorMessage(cause));
    });
    return () => { active = false; };
  }, [goAfterLogin]);
  const login = async (data: {
    demoAccount: "a" | "b";
  } | {
    email: string;
    password: string;
  }) => {
    if (lock.current)
      return;
    lock.current = true;
    setBusy("demoAccount" in data ? data.demoAccount : "login");
    setError("");
    try {
      const session = await api<AppSession>("/api/login", { method: "POST", body: JSON.stringify(data) });
      setPassword("");
      goAfterLogin(session);
    }
    catch (cause) {
      setError(errorMessage(cause));
    }
    finally {
      lock.current = false;
      setBusy("");
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("이메일 주소를 확인해 주세요.");
      document.getElementById("email")?.focus();
      return;
    }
    if (!password) {
      setError("비밀번호를 입력해 주세요.");
      document.getElementById("password")?.focus();
      return;
    }
    void login({ email: email.trim(), password });
  };
  return <PublicFrame>
    <section className="login-panel">
      <div className="login-intro">
        <p className="eyebrow">나의 측정 기록</p>
        <h1>혈당 기록을<br />차근차근 쌓아요.</h1>
        <p>측정한 혈당을 남기고,<br />최근 7일의 기록을 한눈에 확인하세요.</p>
      </div>
      <div className="login-controls">
        <h2>로그인</h2>
        {params.get("deleted") === "1" && <p className="message" role="status">탈퇴했어요. 계정과 저장한 기록을 삭제했어요.</p>}
        {error && <InlineError>
          {error}
        </InlineError>}
        {!mode && !error && <LoadingState label="로그인 화면을 불러오는 중이에요." />}
        {!mode && error && <button className="button secondary" onClick={() => window.location.reload()}>다시 불러오기</button>}
        {mode === "demo" && <>
          <div className="demo-login-notice">
            <strong>가상 데이터로 미리 사용해 보세요.</strong>
            <p>별도 가입 없이 두 계정으로 기록 저장과 계정 구분을 확인할 수 있어요. 실제 건강정보는 입력하지 마세요.</p>
          </div>
          <div className="demo-account-buttons">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => void login({ demoAccount: "a" })}>
              {busy === "a" ? "로그인 중" : "가상 계정 A로 시작"}
            </button>
            <button
              className="button secondary"
              disabled={Boolean(busy)}
              onClick={() => void login({ demoAccount: "b" })}>
              {busy === "b" ? "로그인 중" : "가상 계정 B로 시작"}
            </button>
          </div>
          <p className="fine-print">계정마다 저장한 기록이 따로 보여요. 로그아웃해도 저장된 기록은 남아요.</p>
        </>}
        {mode === "supabase" && <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              disabled={Boolean(busy)} />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={Boolean(busy)} />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                aria-pressed={showPassword}
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}>
                {showPassword ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
          <button className="button full-width" disabled={Boolean(busy)}>
            {busy ? "로그인 중" : "로그인"}
          </button>
          <p className="fine-print">처음 이용하나요? <Link href="/signup">내 계정 만들기</Link>
          </p>
        </form>}
        {mode === "unconfigured" && <div className="state-box">
          <h3>로그인 연결을 준비하고 있어요.</h3>
          <p>프로젝트 실행 안내에 따라 로컬 시연 모드를 설정한 뒤 다시 열어 주세요.</p>
        </div>}
      </div>
    </section>
    <p className="login-footer">직접 측정한 내용을 기록하는 앱이에요. 진단이나 치료를 제공하지 않아요.</p>
  </PublicFrame>;
}
