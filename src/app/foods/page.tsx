import { AppGate } from "@/components/auth/app-gate";
import { MealFormScreen } from "@/components/meals/meal-form";
export default function FoodsPage() { return <AppGate><MealFormScreen /></AppGate>; }
export const metadata = { title: "음식 검색·영양정보" };
