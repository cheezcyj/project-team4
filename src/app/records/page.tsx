import { Suspense } from "react";
import { AppGate } from "@/components/auth/app-gate";
import { LoadingState } from "@/components/ui/page-parts";
import { RecordsScreen } from "@/components/records/records-screen";
export const metadata = { title: "기록 목록" };
export default function RecordsPage() {
  return <AppGate>
    <Suspense fallback={<LoadingState />}>
      <RecordsScreen />
    </Suspense>
  </AppGate>;
}
