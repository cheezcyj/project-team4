import type { Metadata } from "next";
import "./globals.css";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
export const metadata: Metadata = {
  title: { default: "이어드림", template: "%s · 이어드림" },
  description: "혈당과 식사를 기록하고 내 기록을 확인해요.",
  robots: { index: false, follow: false }
};
export default function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  return <html lang="ko">
    <body>
      {children}
      <AssistantWidget />
    </body>
  </html>;
}
