import { AppGate } from "@/components/auth/app-gate";
import { PreferencesScreen } from "@/components/information/preferences-screen";
export default function PreferencesPage() { return <AppGate><PreferencesScreen /></AppGate>; }
export const metadata = { title: "맞춤 정보 설정" };
