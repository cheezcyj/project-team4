import type { CSSProperties } from "react";

export type IconName = "home" | "drop" | "meal" | "book" | "calendar" | "chart" | "gift" | "news" | "upload" | "user" | "menu" | "close" | "bot" | "arrow" | "search";
const paths: Record<IconName, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  drop: "M12 2C10 6 5 11 5 15a7 7 0 0 0 14 0c0-4-5-9-7-13Z",
  meal: "M4 3v7a3 3 0 0 0 6 0V3M7 3v18M17 3c-3 3-3 8 1 8h2M20 3v18",
  book: "M5 3h15v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 14h17M7 7h9M7 11h6",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 2v6m10-6v6M3 11h18",
  chart: "M3 3v18h18M6 15l4-5 4 3 6-8",
  gift: "M3 8h18v5H3ZM5 13v8h14v-8M12 8v13M12 8C3 9 4 1 8 3c3 1 4 5 4 5Zm0 0c9 1 8-7 4-5-3 1-4 5-4 5Z",
  news: "M4 3h16v18H4ZM7 7h10M7 11h4m-4 4h10m-4-4h4",
  upload: "M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m5 5 14 14M19 5 5 19",
  bot: "M12 3v3M6 7h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3ZM8 12v2m8-2v2m-7 3h6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  search: "M21 21l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
};
export function Icon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
