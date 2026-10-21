import { Suspense } from "react";
import { LoginScreen } from "@/components/auth/login-screen";
import { LoadingState } from "@/components/ui/page-parts";
export const metadata = { title: "로그인" };
export default function LoginPage() {
  return <Suspense fallback={<LoadingState />}>
    <LoginScreen />
  </Suspense>;
}
