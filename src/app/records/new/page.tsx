import { AppGate } from "@/components/auth/app-gate";
import { RecordFormScreen } from "@/components/records/record-form";
export default function NewRecordPage() {
  return <AppGate>
    <RecordFormScreen />
  </AppGate>;
}
export const metadata = { title: "혈당 기록하기" };
