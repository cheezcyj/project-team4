import { AppGate } from "@/components/auth/app-gate";
import { MealFormScreen } from "@/components/meals/meal-form";
export default function MealsPage() { return <AppGate><MealFormScreen /></AppGate>; }
export const metadata = { title: "식사 기록" };
