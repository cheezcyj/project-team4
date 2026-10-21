"use client";
import Link from "next/link";
import type { ReactNode } from "react";
export function PublicFrame({ children }: {
  children: ReactNode;
}) {
  return <div className="public-frame">
    <a className="skip-link" href="#main">본문으로 바로 가기</a>
    <header className="public-header">
      <Link className="brand" href="/login">
        <BrandMark />이어드림</Link>
    </header>
    <main id="main" className="public-main">
      {children}
    </main>
  </div>;
}
export function BrandMark() {
  return <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    aria-hidden="true">
    <rect
      width="28"
      height="28"
      rx="7"
      fill="currentColor" />
    <path
      d="M14 5c-2 4-6 8-6 12a6 6 0 0 0 12 0c0-4-4-8-6-12Z"
      stroke="white"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round" />
  </svg>;
}
