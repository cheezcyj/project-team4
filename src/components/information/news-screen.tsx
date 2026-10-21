"use client";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeading } from "@/components/ui/page-parts";
import styles from "./information.module.css";
export function NewsScreen() { return <AppShell><PageHeading title="건강 뉴스" /><section className={styles.newsEmpty} aria-label="건강 뉴스 목록"><p>아직 등록된 소식이 없어요.</p></section></AppShell>; }
