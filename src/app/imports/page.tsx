import { AppGate } from "@/components/auth/app-gate";
import { ImportsScreen } from "@/components/imports/imports-screen";
export const metadata = { title: "CSV 가져오기" };
export default function ImportsPage() { return <AppGate><ImportsScreen /></AppGate>; }
