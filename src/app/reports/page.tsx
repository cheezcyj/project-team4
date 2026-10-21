import { AppGate } from "@/components/auth/app-gate";
import { ReportsScreen } from "@/components/insights/reports-screen";
export const metadata = { title: "내 혈당 리포트" };
export default function ReportsPage() { return <AppGate><ReportsScreen /></AppGate>; }
