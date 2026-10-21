import { AppGate } from "@/components/auth/app-gate";
import { RecordFormScreen } from "@/components/records/record-form";
export default async function EditRecordPage({ params }: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params; return <AppGate>
    <RecordFormScreen recordId={id} />
  </AppGate>;
}
export const metadata = { title: "기록 상세" };
