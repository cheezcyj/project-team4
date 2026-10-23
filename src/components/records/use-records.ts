"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GlucoseRecord } from "@/lib/domain";
import { api, errorMessage, subscribeRecordChanges } from "@/lib/client/api";
import { useAppSession } from "@/components/auth/app-gate";
export type RecordsResponse = {
  records: GlucoseRecord[];
  range: {
    start: string;
    end: string;
    label: string;
  };
};
export function useRecords(date?: string) {
  const session = useAppSession();
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    // 날짜를 연달아 바꾸면 가장 나중에 시작한 조회 결과만 화면에 반영해요.
    const id = ++request.current;
    setData(null);
    setError("");
    try {
      const result = await api<RecordsResponse>(`/api/records${date ? `?date=${encodeURIComponent(date)}` : ""}`);
      if (request.current === id)
        setData(result);
    }
    catch (cause) {
      if (request.current === id)
        setError(errorMessage(cause));
    }
  }, [date]);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeRecordChanges(() => { if (active) void load(); });
    queueMicrotask(() => {
      if (active)
        void load();
    });
    return () => { active = false; unsubscribe(); request.current += 1; };
  }, [load, session.user?.id]);
  return { data, error, load };
}
