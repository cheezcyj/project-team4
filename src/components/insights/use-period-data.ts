"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DateRange, GlucoseRecord, MealRecord } from "@/lib/domain";
import { api, errorMessage, subscribeRecordChanges } from "@/lib/client/api";
import { useAppSession } from "@/components/auth/app-gate";
export type PeriodData = { records: GlucoseRecord[]; meals: MealRecord[]; range: DateRange };
export function usePeriodData(query: string, includeMeals = true) {
  const session = useAppSession();
  const [data, setData] = useState<PeriodData | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const invalidate = useCallback(() => { ++request.current; }, []);
  const load = useCallback(async () => {
    const id = ++request.current;
    setData(null); setError("");
    try {
      const [glucose, meals] = await Promise.all([
        api<{ records: GlucoseRecord[]; range: DateRange }>(`/api/records${query ? `?${query}` : ""}`),
        includeMeals ? api<{ meals: MealRecord[] }>(`/api/meals${query ? `?${query}` : ""}`) : Promise.resolve({ meals: [] }),
      ]);
      if (request.current === id) setData({ ...glucose, meals: meals.meals });
    } catch (cause) { if (request.current === id) setError(errorMessage(cause)); }
  }, [query, includeMeals]);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeRecordChanges(() => { if (active) void load(); });
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; unsubscribe(); invalidate(); };
  }, [load, invalidate, session.user?.id]);
  return { data, error, load };
}
