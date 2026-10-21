import { AppGate } from "@/components/auth/app-gate";
import { ComparisonScreen } from "@/components/insights/comparison-screen";
export const metadata = { title: "측정 조건·기간 비교" };
export default function ComparisonPage() { return <AppGate><ComparisonScreen /></AppGate>; }
