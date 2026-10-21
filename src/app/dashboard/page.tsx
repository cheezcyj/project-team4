import { AppGate } from "@/components/auth/app-gate";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
export const metadata = { title: "혈당 한눈에" };
export default function DashboardPage() {
  return <AppGate>
    <DashboardScreen />
  </AppGate>;
}
