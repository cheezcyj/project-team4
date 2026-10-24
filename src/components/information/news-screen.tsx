"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { InlineError, LoadingState, PageHeading } from "@/components/ui/page-parts";
import { Icon } from "@/components/ui/icon";
import { api, errorMessage } from "@/lib/client/api";
import type { NewsFeed } from "@/lib/domain/news";
import styles from "./news.module.css";

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });
const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/g, "");

export function NewsScreen() {
  return <AppShell><PageHeading title="건강 뉴스" description="보건복지부에서 전하는 건강과 생활 소식을 확인해요." />
    <Suspense fallback={<LoadingState label="건강 소식을 불러오는 중이에요." />}><NewsContent /></Suspense>
  </AppShell>;
}

function NewsContent() {
  const params = useSearchParams();
  const query = (params.get("q") ?? "").slice(0, 80);
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(6);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const load = useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const current = ++generation.current;
    void api<NewsFeed>("/api/news", { signal: controller.signal }, { timeoutMs: 35_000 }).then(result => {
      if (controller.signal.aborted || current !== generation.current) return;
      setFeed(result);
    }, cause => {
      if (!controller.signal.aborted && current === generation.current) setError(errorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted && current === generation.current) setLoading(false);
    });
  }, []);
  useEffect(() => {
    const requests = active;
    void load();
    return () => { requests.current?.abort(); };
  }, [load]);
  const refresh = () => { setLoading(true); setError(""); void load(); };

  const changeQuery = (value: string) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("q", value); else url.searchParams.delete("q");
    // Let Next.js carry its own history metadata so useSearchParams receives this change.
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setLimit(6);
  };
  const normalized = normalize(query);
  const articles = feed?.articles.filter(article => !normalized || normalize(`${article.title} ${article.summary}`).includes(normalized)) ?? [];
  const stale = feed?.refresh.status === "stale";
  return <>
    <div className={styles.toolbar}>
      <div className={styles.search}>
        <label htmlFor="news-search">소식 검색</label>
        <div className={styles.searchControl}>
          <Icon name="search" size={20} />
          <input ref={input} id="news-search" type="search" placeholder="제목이나 내용으로 검색" value={query} maxLength={80} onChange={event => changeQuery(event.target.value)} />
          {query && <button type="button" className={styles.clear} aria-label="소식 검색어 지우기" onClick={() => { changeQuery(""); input.current?.focus(); }}>×</button>}
        </div>
      </div>
      <button className={`button secondary ${styles.refresh}`} type="button" disabled={loading} onClick={refresh}>{loading ? "불러오는 중" : "새로 불러오기"}</button>
    </div>
    <div className={styles.resultsInfo} role="status"><span>{feed ? (query ? `검색 결과 ${articles.length}개` : `최근 소식 ${articles.length}개`) : ""}</span>
      {feed && <span>조회 {time.format(new Date(feed.refresh.last_success_at))}</span>}
    </div>
    {error && <InlineError>{error}{feed ? " 마지막으로 불러온 소식을 표시해요." : ""}</InlineError>}
    {stale && !error && <InlineError>{feed.refresh.error} 마지막으로 확인한 소식을 표시해요.</InlineError>}
    <section className={styles.list} aria-label="건강 뉴스 목록" aria-busy={loading}>
      {!feed && loading ? <LoadingState label="건강 소식을 불러오는 중이에요." /> : !feed ? <div className={styles.empty}>
        <h2>건강 소식을 불러오지 못했어요.</h2><p>연결 상태를 확인한 뒤 다시 불러와 주세요.</p>
        <button className="button secondary" onClick={refresh}>다시 불러오기</button>
      </div> : !articles.length ? <div className={styles.empty}>
        <h2>{query ? "검색 결과가 없어요." : "아직 등록된 소식이 없어요."}</h2>
        <p>{query ? "다른 단어로 검색해 보세요." : "새로운 소식이 확인되면 이곳에 표시돼요."}</p>
      </div> : articles.slice(0, limit).map(article => <article className={styles.article} key={article.id}>
        <div className={styles.articleHeading}>
          <h2><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h2>
          <a className={styles.original} href={article.url} target="_blank" rel="noopener noreferrer" aria-label={`${article.title} 원문 보기 (새 탭)`}>원문 보기 <Icon name="arrow" size={18} /></a>
        </div>
        {article.summary && <p className={styles.summary}>{article.summary}</p>}
        <footer className={styles.articleFooter}>
          <div className={styles.meta}>
            {article.published_at && <time dateTime={article.published_at}>{date.format(new Date(article.published_at))}</time>}
            <span>{article.source}{article.author ? ` · ${article.author}` : ""}</span>
          </div>
          <a className={styles.license} href={article.license_url} target="_blank" rel="noopener noreferrer">공공누리 제1유형 · 출처표시</a>
        </footer>
      </article>)}
    </section>
    {articles.length > limit && <div className={styles.more}><button className="button secondary" onClick={() => setLimit(value => value + 6)}>소식 더 보기 ({Math.min(limit, articles.length)}/{articles.length})</button></div>}
    {feed && <p className={styles.sourceNote}>보건복지부 소식의 일부를 발췌했어요. 자세한 내용과 변경 사항은 원문에서 확인해 주세요.</p>}
  </>;
}
