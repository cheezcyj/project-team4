"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { ASSISTANT_MAX_QUESTION_LENGTH, type AssistantAnswer, type AssistantStatus } from "@/lib/assistant/types";

async function assistantRequest<T>(controller: AbortController, body?: object, url = "/api/assistant"): Promise<T> {
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    }).catch(() => { throw new Error("연결이 끊어졌거나 응답 시간이 길어졌어요. 잠시 후 다시 확인해 주세요."); });
    const result = await response.json().catch(() => { throw new Error("답변을 읽지 못했어요. 잠시 후 다시 확인해 주세요."); });
    if (response.status === 401) window.dispatchEvent(new Event("app-session-expired"));
    if (!response.ok) throw new Error(result.error || "도우미 연결을 확인하지 못했어요.");
    return result as T;
  } finally { clearTimeout(timer); }
}

export function AssistantWidget() {
  const path = usePathname();
  return <AssistantPanel key={path} publicPage={["/login", "/signup", "/"].includes(path)} />;
}

function AssistantPanel({ publicPage }: { publicPage: boolean }) {
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const response = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [recordAllowed, setRecordAllowed] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const clear = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    setQuestion(""); setSubmittedQuestion(""); setAnswer(null); setStatus(null);
    setAllowed(false); setRecordAllowed(false); setPending(false); setLoading(false); setError("");
  }, []);

  const cancelAnswer = () => {
    ++generation.current; request.current?.abort(); request.current = null;
    setPending(false); setQuestion(""); setSubmittedQuestion(""); setAnswer(null); setError("");
  };

  useEffect(() => {
    if (answer && body.current && response.current) {
      body.current.scrollTop = response.current.offsetTop - body.current.offsetTop;
    }
  }, [answer]);

  useEffect(() => {
    const reset = () => { clear(); panel.current?.close(); };
    window.addEventListener("assistant-reset", reset);
    window.addEventListener("glucose-records-changed", reset);
    window.addEventListener("app-session-expired", reset);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glucose-session") : null;
    const recordsChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glucose-records") : null;
    if (channel) channel.onmessage = reset;
    if (recordsChannel) recordsChannel.onmessage = reset;
    return () => {
      generation.current += 1;
      request.current?.abort();
      window.removeEventListener("assistant-reset", reset);
      window.removeEventListener("glucose-records-changed", reset);
      window.removeEventListener("app-session-expired", reset);
      channel?.close();
      recordsChannel?.close();
    };
  }, [clear]);

  const close = () => { clear(); panel.current?.close(); trigger.current?.focus(); };
  const open = async () => {
    panel.current?.showModal();
    if (publicPage) return;
    setLoading(true); setError("");
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    try {
      const result = await assistantRequest<AssistantStatus>(controller);
      if (generation.current === current) setStatus(result);
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error ? failure.message : "도우미 연결을 확인하지 못했어요.");
    } finally {
      if (generation.current === current) { setLoading(false); request.current = null; }
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!status?.available || !allowed || !question.trim() || pending) return;
    const text = question.trim();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setPending(true); setError(""); setAnswer(null); setSubmittedQuestion(text);
    try {
      const result = await assistantRequest<AssistantAnswer>(controller, { question: text, allow_model_processing: allowed });
      if (generation.current === current) setAnswer(result);
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error ? failure.message : "답변을 받지 못했어요. 잠시 후 다시 질문해 주세요.");
    } finally {
      if (generation.current === current) { setPending(false); request.current = null; }
    }
  };

  const summarize = async () => {
    if (!status?.recordSummaryAvailable || !recordAllowed || pending) return;
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setPending(true); setError(""); setAnswer(null); setSubmittedQuestion("최근 7일 공복 혈당 기록 요약");
    try {
      const result = await assistantRequest<AssistantAnswer>(controller, { allow_record_access: true }, "/api/assistant/records-summary");
      if (generation.current === current) setAnswer(result);
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error ? failure.message : "기록 요약을 받지 못했어요.");
    } finally {
      if (generation.current === current) { setPending(false); request.current = null; }
    }
  };

  return <div className="assistant-widget" key={publicPage ? "public" : "private"}>
    <button ref={trigger} className="assistant-trigger" aria-label="도우미 열기" aria-haspopup="dialog" onClick={open}><Icon name="bot" size={27} /></button>
    <dialog ref={panel} className="assistant-panel" aria-labelledby="assistant-title" aria-describedby="assistant-description"
      onCancel={event => { event.preventDefault(); close(); }}>
      <header className="assistant-header"><Icon name="bot" size={28} /><div><h2 id="assistant-title">이어드림 도우미</h2><p>건강정보와 공복 기록 요약</p></div>
        <button className="icon-button" aria-label="도우미 닫기" onClick={close}><Icon name="close" /></button></header>
      <div ref={body} className="assistant-body">
        <div className="assistant-welcome"><span className="assistant-welcome-icon"><Icon name="bot" size={28} /></span>
          <h3>{status?.available ? "건강정보를 물어보세요." : status?.recordSummaryAvailable ? "공복 기록을 확인해 보세요." : "도우미를 준비하고 있어요."}</h3>
          <p id="assistant-description">공개 자료로 일반 건강정보를 안내해요. 별도로 동의하면 최근 7일 공복 기록을 요약해요. 진단이나 치료 판단은 하지 않아요.</p></div>
        {status?.draftPreview && <p className="assistant-preview">검토 중인 자료로 동작하는 개발용 미리보기입니다.</p>}
        <p role="status">{loading ? "도우미 연결을 확인하고 있어요." : pending ? "자료를 확인하고 답변을 만들고 있어요." : status?.message}</p>
        {error && <p role="alert" className="assistant-error">{error}</p>}
        {status?.recordSummaryAvailable && <div className="assistant-record-tool">
          <label className="assistant-consent"><input type="checkbox" checked={recordAllowed}
            onChange={event => { setRecordAllowed(event.target.checked); if (!event.target.checked) cancelAnswer(); }} />이번 요약을 위해 본인의 최근 7일 공복 기록 조회에 동의합니다.</label>
          <p>오늘 포함 7일, 한국시간 기준이에요. 기록은 서버에서 계산하며 AI에 보내지 않아요. 체크를 해제하면 진행 중 요약과 화면의 답변을 지워요.</p>
          <button type="button" className="button small" disabled={!recordAllowed || pending} onClick={() => void summarize()}>공복 기록 요약</button>
        </div>}
        {answer && <section ref={response} className="assistant-answer" aria-label="도우미 답변" aria-live="polite">
          <h3>질문</h3><p>{submittedQuestion}</p><h3>답변</h3><p>{answer.answer}</p>
          {answer.kind === "record_summary" && answer.recordSummary && <p className="assistant-helper">출처: 본인 혈당 기록 · 측정 상황 ‘공복’만 포함 · 조회 시각 {new Date(answer.recordSummary.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국시간). 기록은 AI에 전송하지 않았어요.</p>}
          {answer.citations.length > 0 && <><h3>참고 자료</h3><ul>{answer.citations.map(citation => <li key={citation.id}>
            <a href={citation.url} target="_blank" rel="noreferrer noopener">{citation.publisher} · {citation.title}</a>
            {citation.section && <span> — {citation.section}</span>}
            {citation.pdfPages.length > 0 && <span> (PDF {citation.pdfPages.join(", ")}쪽)</span>}
            {citation.evidenceRole === "background_only" && <span> (제품 제한 설명의 배경 근거)</span>}
            {citation.reuseLabel && citation.reuseUrl && <p>이용조건: <a href={citation.reuseUrl} target="_blank" rel="noreferrer noopener">{citation.reuseLabel}</a></p>}
            {citation.attribution && <p>{citation.attribution}</p>}
            {citation.adaptationNotice && <p>{citation.adaptationNotice}</p>}
          </li>)}</ul></>}
        </section>}
        {publicPage ? <p className="assistant-helper">로그인 후 도우미를 이용할 수 있어요.</p> : <nav className="assistant-shortcuts" aria-label="기록 바로가기">
          <Link href="/records/new" onClick={close}>혈당 기록하기 <Icon name="arrow" size={18} /></Link>
          <Link href="/meals/new" onClick={close}>식사 기록하기 <Icon name="arrow" size={18} /></Link>
          <Link href="/reports" onClick={close}>내 리포트 보기 <Icon name="arrow" size={18} /></Link>
        </nav>}
      </div>
      <form className="assistant-composer" onSubmit={send}>
        {status?.available && <label className="assistant-consent"><input type="checkbox" checked={allowed}
          onChange={event => { setAllowed(event.target.checked); if (!event.target.checked) cancelAnswer(); }} />질문과 참고 자료를 AI로 처리하는 데 동의합니다.</label>}
        <label htmlFor="assistant-question">질문</label>
        <div className="assistant-input"><textarea id="assistant-question" className="resize-none" rows={2}
          maxLength={ASSISTANT_MAX_QUESTION_LENGTH} placeholder={status?.available ? "예: 당화혈색소가 무엇인가요?" : "도우미가 준비되면 질문할 수 있어요."}
          value={publicPage ? "" : question} disabled={publicPage || pending} onChange={event => setQuestion(event.target.value)} />
          <button className="button small" type="submit" disabled={!status?.available || !allowed || pending || !question.trim()}
            aria-label={status?.available ? "질문 전송" : "질문 전송 준비 중"}>{pending ? "답변 중" : "전송"}</button></div>
        <p>{status?.available ? "앱에 질문·답변을 저장하지 않아요. 이름·연락처·개인 검사 결과는 입력하지 마세요." : "질문 전송 준비 중"}</p>
      </form>
    </dialog>
  </div>;
}
