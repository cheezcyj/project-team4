import assert from "node:assert/strict";
import test from "node:test";
import { api, RequestError } from "../../src/lib/client/api";

test("호출 취소를 fetch에 전달하면서 기록 변경 전후 알림과 결과 미확인 처리를 유지한다", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  const originalFetch = globalThis.fetch;
  const events = new EventTarget();
  let notifications = 0;
  events.addEventListener("glucose-records-changed", () => notifications++);
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: undefined });
  const caller = new AbortController();
  let fetchSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    fetchSignal = init?.signal;
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    fetchSignal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  });
  try {
    const request = api("/api/records", { method: "POST", signal: caller.signal }, { timeoutMs: 35_000 });
    assert.equal(notifications, 1);
    assert.ok(fetchSignal);
    assert.equal(fetchSignal.aborted, false);
    caller.abort();
    await assert.rejects(request, (error: unknown) => error instanceof RequestError && error.code === "UNKNOWN_OUTCOME");
    assert.equal(fetchSignal.aborted, true);
    assert.equal(notifications, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalChannel) Object.defineProperty(globalThis, "BroadcastChannel", originalChannel); else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});
