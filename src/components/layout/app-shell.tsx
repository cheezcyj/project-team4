"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { clearDraft } from "@/lib/client/form-memory";
import { useAppSession } from "@/components/auth/app-gate";
import { BrandMark } from "@/components/layout/public-frame";
import { InlineError } from "@/components/ui/page-parts";
import { Icon, type IconName } from "@/components/ui/icon";

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "대시보드", icon: "home" },
  { href: "/records/new", label: "혈당 기록", icon: "drop" },
  { href: "/meals/new", label: "식사 기록", icon: "meal" },
  { href: "/records", label: "통합 일지", icon: "book" },
  { href: "/calendar", label: "기록 캘린더", icon: "calendar" },
  { href: "/reports", label: "혈당 리포트", icon: "chart" },
  { href: "/benefits", label: "맞춤 정책·혜택", icon: "gift" },
  { href: "/news", label: "건강 뉴스", icon: "news" },
];
const mobileNavigation = [navigation[0], { ...navigation[3], label: "일지" }, { ...navigation[4], label: "달력" }, { ...navigation[5], label: "리포트" }, { ...navigation[6], label: "혜택" }];
export function AppShell({ children, guard, busy = false }: { children: ReactNode; guard?: (action: () => void) => void; busy?: boolean }) {
  const session = useAppSession();
  const accountLabel = session.mode === "demo" ? (session.user?.email.includes("a@") ? "가상 계정 A" : "가상 계정 B") : session.user?.email;
  const router = useRouter();
  const path = usePathname();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState("");
  const menu = useRef<HTMLDialogElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { menu.current?.close(); menuTrigger.current?.focus(); };
  const go = (href: string) => {
    if (busy) return;
    closeMenu();
    const action = () => router.push(href);
    if (guard) guard(action); else action();
  };
  const logout = () => {
    const action = async () => {
      setLogoutBusy(true); setError("");
      try {
        await api("/api/logout", { method: "POST" });
        clearDraft(); window.dispatchEvent(new Event("assistant-reset"));
        router.replace("/login"); router.refresh();
      } catch (cause) { setError(errorMessage(cause)); setLogoutBusy(false); }
    };
    if (guard) guard(() => void action()); else void action();
  };
  const isCurrent = (href: string) => href === path || (href === "/reports" && path === "/comparison") || (href === "/meals/new" && path.startsWith("/meals/")) || (href === "/records/new" && /\/records\/.+\/edit/.test(path));
  const links = (items: typeof navigation) => items.map(item => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined} onClick={event => { event.preventDefault(); go(item.href); }}><Icon name={item.icon} /><span>{item.label}</span></Link>);
  return <div className="app-shell">
    <a className="skip-link" href="#main">본문으로 바로 가기</a>
    <aside className="app-sidebar">
      <Link className="brand" href="/dashboard" onClick={event => { event.preventDefault(); go("/dashboard"); }}><BrandMark />이어드림</Link>
      <nav className="sidebar-nav" aria-label="주 메뉴">{links(navigation)}</nav>
      <nav className="sidebar-tools" aria-label="기록 도구">{links([{ href: "/imports", label: "CSV 가져오기", icon: "upload" }])}</nav>
      <p className="sidebar-caption">혈당과 식사를 함께 기록해요.</p>
    </aside>
    <div className="app-body">
      <header className="app-header"><div className="header-inner">
        <div className="header-brand"><button ref={menuTrigger} className="icon-button mobile-menu-trigger" aria-label="전체 메뉴 열기" disabled={busy} onClick={() => menu.current?.showModal()}><Icon name="menu" /></button><Link className="brand" href="/dashboard" onClick={event => { event.preventDefault(); go("/dashboard"); }}><Icon name="drop" />이어드림</Link></div>
        <div className="account-actions"><Link className="account-label" href="/mypage" aria-label={`${accountLabel} 마이페이지`} aria-current={path === "/mypage" ? "page" : undefined} onClick={event => { event.preventDefault(); go("/mypage"); }}><span>{accountLabel}</span><Icon name="user" /></Link><button className="text-button" disabled={busy || logoutBusy} onClick={logout}>{logoutBusy ? "로그아웃 중" : "로그아웃"}</button></div>
      </div></header>
      <div className="workspace">
        {session.mode === "demo" && <p className="demo-note"><strong>가상 데이터 시연</strong><span>실제 건강정보는 입력하지 마세요.</span></p>}
        {error && <InlineError>{error}</InlineError>}
        <main id="main">{children}</main>
        <footer className="app-footer">기록 시간은 한국 시간 기준이에요. 이 앱은 진단이나 치료를 제공하지 않아요.</footer>
      </div>
    </div>
    <nav className="mobile-bottom-nav" aria-label="하단 메뉴">{links(mobileNavigation)}</nav>
    <dialog ref={menu} className="navigation-dialog" aria-labelledby="navigation-title" onCancel={event => { event.preventDefault(); closeMenu(); }}>
      <div className="navigation-dialog-heading"><h2 id="navigation-title">전체 메뉴</h2><button className="icon-button" aria-label="전체 메뉴 닫기" onClick={closeMenu}><Icon name="close" /></button></div>
      <nav aria-label="전체 메뉴">{links([...navigation, { href: "/imports", label: "CSV 가져오기", icon: "upload" }, { href: "/mypage", label: "마이페이지", icon: "user" }])}</nav>
    </dialog>
  </div>;
}
