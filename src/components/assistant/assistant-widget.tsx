"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

// AI 요청과 개인 자료 접근은 모델 설계 확정 후 별도 연결해요.
export function AssistantWidget() {
  const path = usePathname();
  return <AssistantPanel key={path} publicPage={["/login", "/signup", "/"].includes(path)} />;
}
function AssistantPanel({ publicPage }: { publicPage: boolean }) {
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [question, setQuestion] = useState("");
  useEffect(() => {
    const reset = () => { setQuestion(""); panel.current?.close(); };
    window.addEventListener("assistant-reset", reset);
    window.addEventListener("app-session-expired", reset);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glucose-session") : null;
    if (channel) channel.onmessage = reset;
    return () => { window.removeEventListener("assistant-reset", reset); window.removeEventListener("app-session-expired", reset); channel?.close(); };
  }, []);
  const close = () => { panel.current?.close(); trigger.current?.focus(); };
  return <div className="assistant-widget" key={publicPage ? "public" : "private"}>
    <button ref={trigger} className="assistant-trigger" aria-label="도우미 열기" aria-haspopup="dialog" onClick={() => panel.current?.showModal()}><Icon name="bot" size={27} /></button>
    <dialog ref={panel} className="assistant-panel" aria-labelledby="assistant-title" aria-describedby="assistant-description" onCancel={event => { event.preventDefault(); close(); }}>
      <header className="assistant-header"><Icon name="bot" size={28} /><div><h2 id="assistant-title">이어드림 도우미</h2><p>혈당·식사 기록 안내</p></div><button className="icon-button" aria-label="도우미 닫기" onClick={close}><Icon name="close" /></button></header>
      <div className="assistant-body"><div className="assistant-welcome"><span className="assistant-welcome-icon"><Icon name="bot" size={28} /></span><h3>도우미를 준비하고 있어요.</h3><p id="assistant-description">아직 질문을 보내거나 답변을 받을 수 없어요. 입력한 내용은 전송하거나 저장하지 않아요.</p></div>
        {publicPage ? <p className="assistant-helper">로그인하면 혈당과 식사를 기록하고 내 기록을 확인할 수 있어요.</p> : <nav className="assistant-shortcuts" aria-label="기록 바로가기"><Link href="/records/new" onClick={close}>혈당 기록하기 <Icon name="arrow" size={18} /></Link><Link href="/meals/new" onClick={close}>식사 기록하기 <Icon name="arrow" size={18} /></Link><Link href="/reports" onClick={close}>내 리포트 보기 <Icon name="arrow" size={18} /></Link></nav>}
      </div>
      <div className="assistant-composer"><label htmlFor="assistant-question">질문</label><div className="assistant-input"><textarea id="assistant-question" className="resize-none" rows={2} maxLength={2000} placeholder="도우미가 준비되면 질문할 수 있어요." value={publicPage ? "" : question} disabled={publicPage} onChange={event => setQuestion(event.target.value)} /><button className="button small" disabled aria-label="질문 전송 준비 중">전송</button></div><p>질문 전송 준비 중</p></div>
    </dialog>
  </div>;
}
