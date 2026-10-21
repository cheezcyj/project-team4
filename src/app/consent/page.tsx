import { AppGate } from "@/components/auth/app-gate";
import { ConsentScreen } from "@/components/auth/consent-screen";
export default function ConsentPage() {
  return <AppGate>
    <ConsentScreen />
  </AppGate>;
}
export const metadata = { title: "이용 안내" };
