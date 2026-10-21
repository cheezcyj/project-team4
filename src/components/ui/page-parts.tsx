"use client";
import type { ReactNode } from "react";
export function PageHeading({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return <div className="page-heading">
    <div>
      <h1>
        {title}
      </h1>
      {description && <p>
        {description}
      </p>}
    </div>
    {action}
  </div>;
}
export function LoadingState({ label = "기록을 불러오는 중이에요." }: {
  label?: string;
}) {
  return <div className="state-box" role="status">
    <span className="loading-dot" aria-hidden="true" />
    <p>
      {label}
    </p>
  </div>;
}
export function InlineError({ children }: {
  children: ReactNode;
}) {
  return <p className="message error-message" role="alert">
    {children}
  </p>;
}
export function ErrorState({ message, retry }: {
  message: string;
  retry?: () => void;
}) {
  return <div className="state-box error-state" role="alert">
    <h2>불러오지 못했어요</h2>
    <p>
      {message}
    </p>
    {retry && <button className="button secondary" onClick={retry}>다시 불러오기</button>}
  </div>;
}
