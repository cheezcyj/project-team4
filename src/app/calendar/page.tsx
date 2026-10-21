import { AppGate } from "@/components/auth/app-gate";
import { CalendarScreen } from "@/components/insights/calendar-screen";
export const metadata = { title: "혈당 기록 캘린더" };
export default function CalendarPage() { return <AppGate><CalendarScreen /></AppGate>; }
