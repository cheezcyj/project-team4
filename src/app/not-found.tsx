import Link from "next/link";
export default function NotFound() {
  return <main className="standalone">
    <h1>페이지를 찾을 수 없어요.</h1>
    <p>주소를 확인하거나 혈당 한눈에로 이동해 주세요.</p>
    <Link href="/dashboard">혈당 한눈에</Link>
  </main>;
}
