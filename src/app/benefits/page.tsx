import { AppGate } from "@/components/auth/app-gate";
import { BenefitsScreen } from "@/components/information/benefits-screen";
export default function BenefitsPage() { return <AppGate><BenefitsScreen /></AppGate>; }
export const metadata = { title: "맞춤 정책·혜택" };
