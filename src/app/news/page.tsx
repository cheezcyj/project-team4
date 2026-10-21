import { AppGate } from "@/components/auth/app-gate";
import { NewsScreen } from "@/components/information/news-screen";
export default function NewsPage() { return <AppGate><NewsScreen /></AppGate>; }
export const metadata = { title: "건강 뉴스" };
