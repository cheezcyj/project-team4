"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
export function ConfirmDialog({ open, title, children, confirmLabel, onCancel, onConfirm, pending = false, danger = false }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  danger?: boolean;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // 열 때 취소 버튼부터 선택하고, 닫을 때는 창을 열었던 위치로 돌아가요.
  useEffect(() => {
    if (open && !dialog.current?.open) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      cancelButton.current?.focus();
    }
    else if (!open && dialog.current?.open) {
      dialog.current.close();
      returnFocus.current?.focus();
    }
  }, [open]);
  return <dialog
    ref={dialog}
    className="confirm-dialog"
    aria-labelledby={titleId}
    onKeyDown={event => {
      // 키보드의 Tab 키가 확인창 뒤쪽의 화면으로 빠져나가지 않게 해요.
      if (event.key !== "Tab")
        return;
      const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), [tabindex='0']"));
      if (!targets.length) {
        event.preventDefault();
        return;
      }
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }}
    onCancel={event => {
      event.preventDefault();
      if (!pending)
        onCancel();
    }}>
    <h2 id={titleId}>
      {title}
    </h2>
    <div className="dialog-body">
      {children}
    </div>
    <div className="dialog-actions">
      <button
        ref={cancelButton}
        className="button secondary"
        disabled={pending}
        onClick={onCancel}>취소</button>
      <button className={`button ${danger ? "danger" : ""}`} disabled={pending} onClick={onConfirm}>
        {pending ? "처리 중" : confirmLabel}
      </button>
    </div>
  </dialog>;
}
