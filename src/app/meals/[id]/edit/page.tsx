import { AppGate } from "@/components/auth/app-gate";
import { MealFormScreen } from "@/components/meals/meal-form";
export default async function EditMealPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AppGate><MealFormScreen mealId={id} /></AppGate>; }
export const metadata = { title: "식사 상세·수정" };
