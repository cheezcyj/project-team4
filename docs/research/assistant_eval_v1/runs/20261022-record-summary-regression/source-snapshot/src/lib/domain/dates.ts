import type { DateRange } from "./types";

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
// 2월 30일처럼 날짜 모양만 맞는 값도 걸러요.
export function isCalendarDay(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// 시간대가 없는 날짜를 서버 위치에 따라 다르게 해석하지 않도록, 시간대 표시를 필수로 받아요.
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^([1-9]\d{3}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !isCalendarDay(match[1])) return false;
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59) return false;
  if (match[5] !== "Z" && (+match[6] > 23 || +match[7] > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

export function seoulDay(instant: string | Date = new Date()): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (!Number.isFinite(date.getTime())) throw new Error("날짜를 확인해 주세요.");
  return new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

export function dayRange(day: string): DateRange {
  if (!isCalendarDay(day)) throw new Error("날짜를 확인해 주세요.");
  const start = Date.parse(`${day}T00:00:00+09:00`);
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + DAY_MS).toISOString(),
    label: day,
  };
}

// 오늘을 포함한 7일이며 끝은 내일 자정이에요. 조회할 때 끝 시각은 포함하지 않아요.
export function recentRange(now: string | Date = new Date()): DateRange {
  return daysRange(7, now);
}

export function daysRange(days: number, now: string | Date = new Date()): DateRange {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('기간을 확인해 주세요.');
  const today = dayRange(seoulDay(now));
  const start = new Date(Date.parse(today.start) - (days - 1) * DAY_MS).toISOString();
  return {start,end:today.end,label:`${seoulDay(start)} ~ ${seoulDay(now)}`};
}
export function monthRange(month: string): DateRange {
  if (!/^\d{4}-\d{2}$/.test(month) || !isCalendarDay(`${month}-01`)) throw new Error('월을 확인해 주세요.');
  const [year, number] = month.split('-').map(Number);
  const next = `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2,'0')}-01`;
  return {start:dayRange(`${month}-01`).start,end:dayRange(next).start,label:month};
}
export function previousRange(range: DateRange): DateRange {
  const end = range.start;
  const start = new Date(Date.parse(end) - (Date.parse(range.end) - Date.parse(range.start))).toISOString();
  return {start,end,label:`${seoulDay(start)} ~ ${seoulDay(new Date(Date.parse(end)-1))}`};
}
export function queryRange(query: import('./service-types').RangeQuery = {}): DateRange {
  const modes = [query.date,query.month,query.days,query.start || query.end].filter(value => value !== null && value !== undefined && value !== '').length;
  if (modes > 1) throw new Error('기간을 한 가지 방식으로 선택해 주세요.');
  if (query.date) return dayRange(query.date);
  if (query.month) return monthRange(query.month);
  if (query.start || query.end) {
    if (!query.start || !query.end) throw new Error('시작일과 종료일을 선택해 주세요.');
    const start=dayRange(query.start).start, end=dayRange(query.end).end;
    if (Date.parse(end)<=Date.parse(start) || Date.parse(end)-Date.parse(start)>366*DAY_MS) throw new Error('기간은 1일부터 366일까지 선택해 주세요.');
    return {start,end,label:`${query.start} ~ ${query.end}`};
  }
  const days = query.days == null ? 7 : Number(query.days);
  if (![7,14,28].includes(days)) throw new Error('7일·14일·28일 중 선택해 주세요.');
  return daysRange(days);
}

// 입력창의 한국 시간을 저장용 UTC 시간으로 바꿔요. PC의 시간대 설정은 사용하지 않아요.
export function seoulInputToIso(value: string): string | null {
  const candidate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? `${value}:00+09:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value}+09:00`
      : "";
  return isTimestamp(candidate) ? new Date(candidate).toISOString() : null;
}

export function isoToSeoulInput(value: string = new Date().toISOString()): string {
  if (!isTimestamp(value)) return "";
  return new Date(Date.parse(value) + SEOUL_OFFSET_MS).toISOString().slice(0, 16);
}
