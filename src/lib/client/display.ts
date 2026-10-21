"use client";
import { contexts as domainContexts, type GlucoseRecord } from "@/lib/domain";
export const contexts = Object.fromEntries(domainContexts.map(context => [context.value, context.label])) as Record<GlucoseRecord["measurement_context"], string>;
// 브라우저가 다른 나라 시간대를 쓰더라도 기록은 한국 시간으로 보여줘요.
export function displayTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
