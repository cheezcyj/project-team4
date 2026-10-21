import { AppGate } from "@/components/auth/app-gate";
import { MyPageScreen } from "@/components/account/mypage-screen";
export const metadata = { title: "마이페이지" };
export default function MyPage() {
  return <AppGate>
    <MyPageScreen />
  </AppGate>;
}
