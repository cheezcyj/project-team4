"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { useAppSession } from "@/components/auth/app-gate";
import { AppShell } from "@/components/layout/app-shell";
import { InlineError, PageHeading } from "@/components/ui/page-parts";
export function ConsentScreen() {
  const session = useAppSession();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const submit = async () => {
    if (!agreed || lock.current)
      return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await api("/api/consent", { method: "POST", body: JSON.stringify({ agreed: true }) });
      router.replace("/dashboard");
      router.refresh();
    }
    catch (cause) {
      setError(errorMessage(cause));
    }
    finally {
      lock.current = false;
      setPending(false);
    }
  };
  return <AppShell busy={pending}>
    <div className="narrow-content">
      <PageHeading
        title="이용 전 확인해 주세요"
        description={session.mode === "demo" ? "가상 데이터로 기록 저장과 조회를 체험해요." : "기록하기 전에 정보 이용 안내를 확인해 주세요."} />
      <div className="policy-sections">
        <section>
          <h2>기록하는 항목</h2>
          <p>혈당값, 측정 시각·상황과 식사 시간대, 선택한 메모를 저장해요. 식사는 별도로 시각·종류·음식·섭취량과 메모를 기록할 수 있어요.</p>
          <p>마이페이지의 성별·만 나이·키·몸무게는 선택 항목이에요. 별도의 개인정보 저장 안내에 동의한 경우에만 저장해요.</p>
        </section>
        <section>
          <h2>이용 목적</h2>
          <p>
            {session.mode === "demo" ? "가상 계정으로 혈당과 식사를 저장·조회·수정·삭제하는 기능을 확인해요." : "본인이 입력한 혈당과 식사 기록을 저장하고 확인하는 데 이용해요."}
          </p>
        </section>
        <details>
          <summary>보관과 삭제 안내</summary>
          <div>
            {session.mode === "demo" ? <p>가상 기록은 앱을 실행한 컴퓨터에 보관돼요. 로그아웃하거나 앱을 다시 열어도 남으며, 기록 화면에서 한 건씩 삭제할 수 있어요. 시연 데이터 파일을 정리할 때까지 보관돼요.</p> : <p>팀 프로젝트 시연용 앱이에요. 각자 만든 계정으로 가상 데이터만 입력해 주세요. 기록은 직접 삭제하거나 탈퇴할 때까지 보관돼요. 실제 건강정보를 다루는 서비스의 운영 기준은 아직 확정되지 않았어요.</p>}
            <p>동의하지 않아도 기존 본인 기록을 확인하고 삭제할 수 있어요. {session.mode === "demo" ? "가상 계정은 탈퇴할 수 없어요." : "마이페이지에서 탈퇴하면 계정, 혈당·식사 기록, 가져오기 이력, 맞춤 조건과 동의 내역을 함께 삭제해요."}
            </p>
            <p>맞춤 정책 조건은 별도 안내를 읽고 선택해요. 도우미의 일반 질문·답변은 대화 보관과 AI 처리에 별도로 동의한 뒤 계정에 저장해요. 답변에는 현재 질문과 최근 일반 대화 일부, 공개 자료를 사용해요.</p>
            <p>마이페이지의 기본 정보는 직접 삭제하거나 회원 탈퇴할 때까지 보관해요. 지금은 도우미 답변에 사용하지 않으며 AI나 뉴스 제공처에 보내지 않아요.</p>
            <p>공복 기록 요약은 기록 조회와 요약 저장에 별도로 동의하면 대화방에 보관해요. 원래 혈당·식사 기록과 저장된 공복 요약은 AI에 보내지 않아요. 저장된 요약은 조회 당시의 값이며 이후 기록 수정으로 바뀌지 않아요.</p>
            <p>대화방을 삭제하면 그 방의 질문·답변·공복 요약이 함께 삭제돼요. 회원 탈퇴 시에는 모든 대화방과 채팅 내역도 삭제돼요. 삭제한 대화는 복구할 수 없어요.</p>
          </div>
        </details>
      </div>
      {session.consent === "current" ? <div className="consent-complete">
        <p>현재 이용 안내에 동의했어요.</p>
        <Link className="button" href="/dashboard">혈당 한눈에 보기</Link>
      </div> : session.consent === "outdated" ? <div className="message">
        <p>동의한 안내문과 현재 안내문이 달라요. 이번 시연에서는 재동의를 지원하지 않아 기존 기록의 확인과 삭제만 가능해요.</p>
        <Link href="/records">기록 확인·삭제</Link>
      </div> : <>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={agreed}
            disabled={pending}
            onChange={event => setAgreed(event.target.checked)} />
          <span>
            {session.mode === "demo" ? "시연 안내를 읽었으며 가상 데이터만 입력할게요." : "가상 건강정보 수집·이용 안내를 읽고 동의해요."}
          </span>
        </label>
        {error && <InlineError>
          {error}
        </InlineError>}
        <button className="button full-width" disabled={!agreed || pending} onClick={() => void submit()}>
          {pending ? "동의를 저장하는 중" : "동의하고 시작하기"}
        </button>
        <p className="fine-print">체크한 뒤 버튼을 눌러야 동의가 저장돼요.</p>
        <Link className="standalone-link" href="/records">동의 없이 기존 기록 확인·삭제</Link>
      </>}
    </div>
  </AppShell>;
}
// 동의가 없거나 오래되어도 기존 기록의 조회와 삭제는 계속 허용해요.
export function ConsentNotice() {
  const session = useAppSession();
  return session.consent !== "current" ? <div className="consent-notice">
    <div>
      <strong>기존 기록을 확인하고 삭제할 수 있어요.</strong>
      <p>
        {session.consent === "outdated" ? "안내문이 바뀌어 새 기록과 수정은 잠시 사용할 수 없어요." : "새로 저장하거나 수정하려면 이용 안내를 확인해 주세요."}
      </p>
    </div>
    <Link className="button secondary small" href="/consent">이용 안내 보기</Link>
  </div> : null;
}
