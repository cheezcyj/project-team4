"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { clearDraft } from "@/lib/client/form-memory";
import { useAppSession } from "@/components/auth/app-gate";
import { AppShell } from "@/components/layout/app-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError, PageHeading } from "@/components/ui/page-parts";
import { HealthProfileForm, HEALTH_PROFILE_DRAFT_KEY, type HealthProfileFormState } from "./health-profile-form";
export function MyPageScreen() {
  const session = useAppSession();
  // 계정이 바뀌면 이전 계정의 폼·확인창·비밀번호도 함께 초기화해요.
  return <MyPageAccount key={session.user!.id} />;
}
function MyPageAccount() {
  const session = useAppSession();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const [profileState, setProfileState] = useState<HealthProfileFormState>({ dirty: false, pending: false, uncertain: false });
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const lock = useRef(false);
  const busy = pending || profileState.pending;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (profileState.dirty || profileState.uncertain || busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [profileState.dirty, profileState.uncertain, busy]);
  const guard = (action: () => void) => {
    if (busy) return;
    if (profileState.dirty || profileState.uncertain) setLeave(() => action);
    else action();
  };
  const prepare = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!password) {
      setError("현재 비밀번호를 입력해 주세요.");
      document.getElementById("delete-password")?.focus();
      return;
    }
    if (confirmation !== "탈퇴") {
      setError("삭제할 내용을 확인한 뒤 ‘탈퇴’를 입력해 주세요.");
      document.getElementById("delete-confirmation")?.focus();
      return;
    }
    setDialog(true);
  };
  const remove = async () => {
    if (lock.current)
      return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await api("/api/account", { method: "DELETE", body: JSON.stringify({ password, confirmation }) });
      // 서버의 탈퇴 성공을 확인한 뒤 비밀번호와 이 탭의 작성 내용도 비워요.
      setPassword("");
      clearDraft();
      setDialog(false);
      router.replace("/login?deleted=1");
      router.refresh();
    }
    catch (cause) {
      setError(errorMessage(cause));
      setDialog(false);
    }
    finally {
      lock.current = false;
      setPending(false);
    }
  };
  return <AppShell busy={busy} guard={guard}>
    <div className="narrow-content">
      <PageHeading title="마이페이지" description="내 계정과 이용 정보를 확인해요." />
      <section className="account-section" aria-labelledby="account-info">
        <h2 id="account-info">계정 정보</h2>
        <dl className="account-details">
          <div>
            <dt>이메일</dt>
            <dd>
              {session.user?.email}
            </dd>
          </div>
          <div>
            <dt>이용 안내 동의</dt>
            <dd>
              {session.consent === "current" ? "동의했어요" : session.consent === "outdated" ? "이전 안내에 동의했어요" : "아직 동의하지 않았어요"}
            </dd>
          </div>
        </dl>
      </section>
      <HealthProfileForm userId={session.user!.id} canSave={session.consent === "current"} disabled={pending} onStateChange={setProfileState} onConsentOpen={() => guard(() => router.push("/consent"))} />
      <section className="account-section" aria-labelledby="account-records">
        <h2 id="account-records">내 기록 관리</h2>
        <div className="account-links">
          <Link href="/records" onClick={event => { event.preventDefault(); guard(() => router.push("/records")); }}>내 기록 확인·삭제</Link>
          <Link href="/imports" onClick={event => { event.preventDefault(); guard(() => router.push("/imports")); }}>CSV 파일 가져오기</Link>
          <Link href="/preferences" onClick={event => { event.preventDefault(); guard(() => router.push("/preferences")); }}>맞춤 정책 조건 설정</Link>
          <Link href="/consent" onClick={event => { event.preventDefault(); guard(() => router.push("/consent")); }}>정보 이용 안내 보기</Link>
        </div>
      </section>
      <section className="account-section withdrawal-section" aria-labelledby="withdrawal-title">
        <h2 id="withdrawal-title">회원 탈퇴</h2>
        <p>탈퇴하면 계정, 혈당·식사 기록, 성별·나이·키·몸무게, 가져오기 이력, 맞춤 조건과 동의 내역, 도우미봇의 모든 대화방·채팅 내역·저장한 공복 기록 요약이 모두 삭제돼요. 삭제 후에는 복구할 수 없어요.</p>
        {session.mode === "demo" ? <p className="fine-print">가상 계정은 탈퇴할 수 없어요.</p> : !expanded ? <button className="text-button danger-text" disabled={busy} onClick={() => setExpanded(true)}>회원 탈퇴하기</button> : <form onSubmit={prepare} noValidate>
          <div className="field">
            <label htmlFor="delete-password">현재 비밀번호</label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={256}
              disabled={busy}
              onChange={event => setPassword(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="delete-confirmation">‘탈퇴’를 입력해 주세요</label>
            <input
              id="delete-confirmation"
              type="text"
              autoComplete="off"
              value={confirmation}
              disabled={busy}
              onChange={event => setConfirmation(event.target.value)} />
          </div>
          {error && <InlineError>
            {error}
          </InlineError>}
          <div className="form-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => { setExpanded(false); setPassword(""); setConfirmation(""); setError(""); }}>취소</button>
            <button className="button danger" disabled={busy}>
              {pending ? "탈퇴 처리 중" : "탈퇴 내용 확인"}
            </button>
          </div>
        </form>}
      </section>
      <ConfirmDialog
        open={dialog}
        title="계정과 기록을 삭제할까요?"
        confirmLabel="계정과 기록 삭제"
        danger
        pending={pending}
        onCancel={() => setDialog(false)}
        onConfirm={() => void remove()}>
        <p>내 계정과 혈당·식사 기록, 성별·나이·키·몸무게, 가져오기 이력, 맞춤 조건과 동의 내역, 도우미봇의 모든 대화방·채팅 내역·저장한 공복 기록 요약을 영구 삭제해요. 다른 팀원의 계정과 공통 자료는 남아요.</p>
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(leave)} title="저장하지 않고 이동할까요?" confirmLabel="저장하지 않고 이동" onCancel={() => setLeave(null)} onConfirm={() => { const action = leave; clearDraft(HEALTH_PROFILE_DRAFT_KEY); setLeave(null); action?.(); }}>
        <p>{profileState.uncertain ? "개인정보의 저장·삭제 결과를 아직 확인하지 못했어요. 이동하면 작성 중인 내용은 사라져요. 다시 돌아와 저장된 정보를 확인해 주세요." : "변경한 개인정보가 아직 저장되지 않았어요. 이동하면 작성 중인 내용은 사라져요."}</p>
      </ConfirmDialog>
    </div>
  </AppShell>;
}
