"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ASSISTANT_MAX_QUESTION_LENGTH, type AssistantAnswer } from "@/lib/assistant/types";
import { ASSISTANT_SUMMARY_QUESTION, MAX_TURNS } from "@/lib/assistant/conversation-types";
import { useConversations } from "./use-conversations";

export function AssistantWidget() {
  const path = usePathname();
  const publicPage = ["/login", "/signup", "/"].includes(path);
  // The private shell survives navigation. Authentication changes get a fresh private state.
  return <AssistantPanel key={publicPage ? "public" : "private"} publicPage={publicPage} />;
}

function AssistantPanel({ publicPage }: { publicPage: boolean }) {
  const chat = useConversations();
  const path = usePathname();
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const [listVisible, setListVisible] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [recordConsent, setRecordConsent] = useState({ path: "", allowed: false });
  const recordAllowed = recordConsent.path === path && recordConsent.allowed;
  const setRecordAllowed = (allowed: boolean) => setRecordConsent({ path, allowed });
  const lastTurn = chat.room?.turns.at(-1);
  const limitReached = (chat.room?.turns.length ?? 0) >= MAX_TURNS && lastTurn?.status !== "failed";
  const { clear, cancelSummary } = chat;
  const clearRecordAccess = useCallback(() => { setRecordConsent({ path: "", allowed: false }); cancelSummary(); }, [cancelSummary]);

  useEffect(() => {
    const reset = () => { clearRecordAccess(); panel.current?.close(); };
    window.addEventListener("glucose-records-changed", reset);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glucose-records") : null;
    if (channel) channel.onmessage = reset;
    return () => { window.removeEventListener("glucose-records-changed", reset); channel?.close(); };
  }, [clearRecordAccess]);
  useEffect(() => { cancelSummary(); }, [path, cancelSummary]);

  useEffect(() => {
    const reset = () => { clear(); clearRecordAccess(); panel.current?.close(); setListVisible(false); setDeleting(null); setDeleteError(""); };
    window.addEventListener("assistant-reset", reset);
    window.addEventListener("app-session-expired", reset);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glucose-session") : null;
    if (channel) channel.onmessage = reset;
    return () => { window.removeEventListener("assistant-reset", reset); window.removeEventListener("app-session-expired", reset); channel?.close(); };
  }, [clear, clearRecordAccess]);
  useEffect(() => {
    if (!listVisible && body.current && latest.current) body.current.scrollTop = latest.current.offsetTop - body.current.offsetTop;
  }, [lastTurn?.id, lastTurn?.status, chat.selected, listVisible]);

  const close = () => { clearRecordAccess(); panel.current?.close(); trigger.current?.focus(); };
  const open = () => { panel.current?.showModal(); if (!publicPage) void chat.load(); };
  const send = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void chat.send(); };
  const newChat = () => { clearRecordAccess(); chat.newChat(); setListVisible(false); };
  const remove = async () => {
    if (!deleting) return;
    setDeletePending(true); setDeleteError("");
    try { await chat.remove(deleting.id); setDeleting(null); }
    catch (failure) { setDeleteError(failure instanceof Error ? failure.message : "삭제 결과를 확인하지 못했어요."); }
    finally { setDeletePending(false); }
  };

  return <div className="assistant-widget">
    <button ref={trigger} className="assistant-trigger" aria-label="도우미 열기" aria-haspopup="dialog" onClick={open}><Icon name="bot" size={27} /></button>
    <dialog ref={panel} className="assistant-panel" aria-labelledby="assistant-title" aria-describedby="assistant-description"
      onCancel={event => { event.preventDefault(); close(); }}>
      <header className="assistant-header"><Icon name="bot" size={28} /><div><h2 id="assistant-title">이어드림 도우미</h2><p>건강정보와 공복 기록 요약</p></div>
        <button className="icon-button" aria-label="도우미 닫기" onClick={close}><Icon name="close" /></button></header>
      <p id="assistant-description" className="sr-only">일반 건강정보를 질문하고 계정에 저장한 대화를 이어갈 수 있어요.</p>
      {!publicPage && <nav className="assistant-room-toolbar" aria-label="대화 관리">
        <button className="button secondary small" aria-pressed={listVisible} onClick={() => setListVisible(value => !value)}>대화 목록</button>
        <button className="button small" onClick={newChat} disabled={chat.sending === "new"}>새 채팅</button>
      </nav>}
      {!publicPage && !listVisible && <div className="assistant-room-heading"><h3>{chat.room?.title ?? "새 채팅"}</h3>
        {chat.room && <button className="assistant-delete" aria-label={`${chat.room.title} 대화 삭제`} onClick={() => { setDeleteError(""); setDeleting(chat.room); }}>삭제</button>}
      </div>}
      <div ref={body} className="assistant-body" aria-busy={chat.loading}>
        {chat.loading && <p role="status">대화를 불러오는 중</p>}
        {listVisible ? <section aria-label="대화 목록">
          <h3 className="assistant-list-title">내 대화</h3>
          {!chat.loading && chat.rooms.length === 0 && !chat.error && <p className="assistant-helper">저장한 대화가 없어요. 새 채팅에서 질문해 보세요.</p>}
          <ul className="assistant-room-list">{chat.rooms.map(item => <li key={item.id} aria-current={chat.selected === item.id ? "true" : undefined}>
            <div className="assistant-room-summary"><button className="assistant-room-open" onClick={() => { clearRecordAccess(); setListVisible(false); void chat.select(item.id); }}>
              <strong>{item.title}</strong>
            </button><time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>
            <button className="assistant-delete" aria-label={`${item.title} 대화 삭제`} onClick={() => { setDeleteError(""); setDeleting(item); }}>삭제</button>
          </li>)}</ul>
          <p className="assistant-storage-note">대화는 계정에 저장돼요. 삭제한 대화는 복구할 수 없어요.</p>
        </section> : <>
          {!chat.room?.turns.length && !chat.loading && <div className="assistant-welcome"><span className="assistant-welcome-icon"><Icon name="bot" size={28} /></span>
            <h3>{chat.status?.available ? "건강정보를 물어보세요." : chat.status?.recordSummaryAvailable ? "공복 기록을 확인해 보세요." : "도우미를 준비하고 있어요."}</h3>
            <p>공개 자료로 일반 건강정보를 안내해요. 별도로 동의하면 공복 기록을 요약해 대화에 저장해요. 진단이나 치료 판단은 하지 않아요.</p>
            {publicPage ? <p className="assistant-helper">로그인 후 도우미를 이용할 수 있어요.</p> : <p className="assistant-helper">{chat.status?.message}</p>}
          </div>}
          {chat.status?.draftPreview && <p className="assistant-preview">검토 중인 자료로 동작하는 개발용 미리보기입니다.</p>}
          {chat.status?.recordSummaryAvailable && <div className="assistant-record-tool">
            <label className="assistant-consent"><input type="checkbox" checked={recordAllowed}
              onChange={event => { setRecordAllowed(event.target.checked); if (!event.target.checked) chat.cancelSummary(); }} />이번 요약을 위해 본인의 최근 7일 공복 기록을 조회하고 요약 결과를 이 대화방에 저장하는 데 동의합니다.</label>
            <p>오늘 포함 7일, 한국시간 기준이에요. 기록과 요약은 AI에 보내지 않아요. 체크를 해제하면 진행 중 요약을 중지해요. 이미 저장된 요약은 대화방을 삭제하면 함께 삭제돼요.</p>
            <button type="button" className="button small" disabled={!recordAllowed || !!chat.sending || chat.pending || chat.loading || limitReached}
              onClick={() => void chat.sendSummary(recordAllowed).finally(() => setRecordAllowed(false))}>공복 기록 요약</button>
          </div>}
          {chat.room && <div className="assistant-conversation" aria-label="대화 내용">{chat.room.turns.map((turn, index) => <div className="assistant-turn" key={turn.id} ref={index === chat.room!.turns.length - 1 ? latest : undefined}>
            <section className="assistant-message assistant-message-user" aria-label="내 질문"><p className="assistant-speaker">나</p><div className="assistant-bubble"><p>{turn.question}</p></div></section>
            {turn.status === "pending" && <div className="assistant-message assistant-message-bot"><p className="assistant-speaker">이어드림</p>
              <div className="assistant-bubble assistant-pending" role="status"><span className="assistant-spinner" aria-hidden="true" />{turn.question === ASSISTANT_SUMMARY_QUESTION ? "기록 요약 중" : "답변 생성 중"}</div></div>}
            {turn.status === "failed" && <div className="assistant-turn-error"><p>{turn.error || "답변을 받지 못했어요."}</p>
              {index === chat.room!.turns.length - 1 && (turn.question === ASSISTANT_SUMMARY_QUESTION
                ? <p>기록 조회·저장에 다시 동의한 뒤 공복 기록 요약을 눌러 주세요.</p>
                : <button className="button secondary small" onClick={() => chat.setDraft(turn.question)}>질문 다시 쓰기</button>)}</div>}
            {turn.answer && <section className="assistant-message assistant-message-bot assistant-answer" aria-label="도우미 답변" aria-live={index === chat.room!.turns.length - 1 ? "polite" : "off"}>
              <SavedAnswer answer={turn.answer} />
            </section>}
          </div>)}</div>}
          {!publicPage && !chat.room?.turns.length && <nav className="assistant-shortcuts" aria-label="기록 바로가기">
            <Link href="/records/new" onClick={close}>혈당 기록하기 <Icon name="arrow" size={18} /></Link>
            <Link href="/meals/new" onClick={close}>식사 기록하기 <Icon name="arrow" size={18} /></Link>
            <Link href="/reports" onClick={close}>내 리포트 보기 <Icon name="arrow" size={18} /></Link>
          </nav>}
        </>}
        {chat.error && <div className="assistant-error"><p role="alert">{chat.error}</p><button className="button secondary small" onClick={() => void chat.load()}>다시 불러오기</button></div>}
      </div>
      {!listVisible && <form className="assistant-composer" onSubmit={send} noValidate>
        {chat.status?.available && <label className="assistant-consent"><input type="checkbox" checked={chat.allowed} disabled={!!chat.sending || chat.pending}
          onChange={event => chat.setAllowed(event.target.checked)} />대화를 계정에 저장하고 이 대화 내용을 AI로 처리하는 데 동의합니다.</label>}
        <label htmlFor="assistant-question">질문</label>
        <div className="assistant-input"><textarea id="assistant-question" className="resize-none" rows={2}
          maxLength={ASSISTANT_MAX_QUESTION_LENGTH} placeholder={chat.status?.available ? "건강정보를 질문해 보세요." : "도우미가 준비되면 질문할 수 있어요."}
          value={publicPage ? "" : chat.draft} disabled={publicPage || !!chat.sending || chat.pending || limitReached} onChange={event => chat.setDraft(event.target.value)} />
          <button className="button small" type="submit" disabled={!chat.status?.available || !chat.allowed || !!chat.sending || chat.pending || chat.loading || !chat.draft.trim() || limitReached}
            aria-label={chat.status?.available ? "질문 전송" : "질문 전송 준비 중"}>{chat.pending || chat.sending ? "답변 중" : "전송"}</button></div>
        <p>{limitReached ? "이 대화방의 저장 한도에 도달했어요. 새 채팅을 시작해 주세요." : "창을 닫아도 저장한 대화는 유지돼요. 이름·연락처·개인 검사 결과는 질문에 입력하지 마세요."}</p>
      </form>}
    </dialog>
    <ConfirmDialog open={!!deleting} title="대화를 삭제할까요?" confirmLabel="대화 삭제" danger pending={deletePending}
      onCancel={() => { setDeleting(null); setDeleteError(""); }} onConfirm={() => void remove()}>
      <p>‘{deleting?.title}’의 모든 질문·답변과 저장된 공복 기록 요약을 계정에서 삭제해요. 원래 혈당 기록은 유지돼요. 삭제한 대화는 복구할 수 없어요.</p>
      {deleteError && <p role="alert" className="assistant-error">{deleteError}</p>}
    </ConfirmDialog>
  </div>;
}

function SavedAnswer({ answer }: { answer: AssistantAnswer }) {
  return <><p className="assistant-speaker">이어드림</p><div className="assistant-bubble"><p>{answer.answer}</p></div>
    {answer.draftPreview && <p className="assistant-helper">검토 중인 개발용 자료로 작성된 답변이에요.</p>}
    {answer.kind === "record_summary" && answer.recordSummary && <p className="assistant-helper">
      출처: 본인 혈당 기록 · 측정 상황 ‘공복’만 포함 · 조회 시각 {new Date(answer.recordSummary.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국시간).
      기록은 AI에 전송하지 않았어요. 조회 당시의 요약이며 이후 기록 변경은 반영되지 않아요.
    </p>}
    {answer.citations.length > 0 && <><h3>참고 자료</h3><ul>{answer.citations.map(citation => <li key={citation.id}>
      <a href={citation.url} target="_blank" rel="noreferrer noopener">{citation.publisher} · {citation.title}</a>
      {citation.section && <span> — {citation.section}</span>}
      {citation.pdfPages.length > 0 && <span> (PDF {citation.pdfPages.join(", ")}쪽)</span>}
      {citation.evidenceRole === "background_only" && <span> (제품 제한 설명의 배경 근거)</span>}
      {(citation.reuseLabel ?? citation.licenseLabel) && (citation.reuseUrl ?? citation.licenseUrl) && <p>이용조건: <a href={citation.reuseUrl ?? citation.licenseUrl} target="_blank" rel="noreferrer noopener">{citation.reuseLabel ?? citation.licenseLabel}</a></p>}
      {citation.attribution && <p>{citation.attribution}</p>}
      {citation.adaptationNotice && <p>{citation.adaptationNotice}</p>}
    </li>)}</ul></>}
  </>;
}
