import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const baseURL = "http://127.0.0.1:3100";
async function account(letter: "a" | "b") {
  const client = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const response = await client.post("/api/login", { data: { demoAccount: letter } });
  expect(response.status()).toBe(200);
  return client;
}
async function agree(client: APIRequestContext) {
  const session = await (await client.get("/api/session")).json();
  if (session.consent === "missing") {
    expect((await client.post("/api/consent", { data: { agreed: true } })).ok()).toBeTruthy();
  }
}
function input(id = randomUUID()) {
  return { id, glucose_mg_dl: 117, measured_at: "2026-10-20T02:30:00.000Z", measurement_context: "before_meal", meal_memo: "통합 검사 가상 기록" };
}

test("비로그인과 다른 출처의 쓰기 요청을 차단한다", async ({ request: client }) => {
  expect((await client.get("/api/records")).status()).toBe(401);
  const csrf = await client.post("/api/login", {
    data: { demoAccount: "a" },
    headers: { Origin: "https://unrelated.example" }
  });
  expect(csrf.status()).toBe(403);
  const health = await client.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
});

test("동의 전 조회·삭제와 동의 후 저장, 계정 간 차단", async () => {
  const a = await account("a");
  const b = await account("b");
  try {
    expect((await (await a.get("/api/session")).json()).consent).toBe("missing");
    const records = await (await a.get("/api/records")).json();
    expect(records.records.length).toBeGreaterThan(0);
    const seed = records.records[0];
    expect((await a.post("/api/records", { data: input() })).status()).toBe(403);
    expect((await a.patch(`/api/records/${seed.id}`, { data: { ...input(seed.id), expected_updated_at: seed.updated_at } })).status()).toBe(403);
    expect((await a.delete(`/api/records/${seed.id}`)).ok()).toBeTruthy();
    expect((await a.post("/api/consent", { data: { agreed: false } })).status()).toBe(422);
    await agree(a);
    const body = input();
    const create = await a.post("/api/records", { data: body });
    expect(create.status()).toBeLessThan(300);
    const { record } = await create.json();
    expect(record.glucose_mg_dl).toBe(117);
    expect(record.id).toBe(body.id);
    expect((await b.get(`/api/records/${record.id}`)).status()).toBe(404);
    const bList = await (await b.get("/api/records?date=2026-10-20")).json();
    expect(bList.records.some((row: { id: string }) => row.id === record.id)).toBe(false);
    await agree(b);
    expect((await b.patch(`/api/records/${record.id}`, { data: { ...body, expected_updated_at: record.updated_at } })).status()).toBe(404);
    expect((await b.delete(`/api/records/${record.id}`)).status()).toBe(404);
    expect((await a.delete(`/api/records/${record.id}`)).ok()).toBeTruthy();
  } finally {
    await a.dispose();
    await b.dispose();
  }
});

test("입력 경계, 같은 ID 재전송과 오래된 수정 요청을 처리한다", async () => {
  const client = await account("a");
  try {
    await agree(client);
    for (const glucose_mg_dl of [0, -1, 1.5, 2147483648, ""]) {
      expect((await client.post("/api/records", { data: { ...input(), glucose_mg_dl } })).status()).toBe(422);
    }
    expect((await client.post("/api/records", { data: { ...input(), meal_memo: "😀".repeat(501) } })).status()).toBe(422);
    const body = { ...input(), meal_memo: "😀".repeat(500) };
    const created = await client.post("/api/records", { data: body });
    expect(created.ok()).toBeTruthy();
    const { record } = await created.json();
    const duplicate = await client.post("/api/records", { data: body });
    expect(duplicate.status()).toBe(409);
    const update = await client.patch(`/api/records/${record.id}`, { data: { ...body, glucose_mg_dl: 121, expected_updated_at: record.updated_at } });
    expect(update.ok()).toBeTruthy();
    const stale = await client.patch(`/api/records/${record.id}`, { data: { ...body, glucose_mg_dl: 999, expected_updated_at: record.updated_at } });
    expect(stale.status()).toBe(409);
    expect((await (await client.get(`/api/records/${record.id}`)).json()).record.glucose_mg_dl).toBe(121);
    expect((await client.delete(`/api/records/${record.id}`)).ok()).toBeTruthy();
  } finally {
    await client.dispose();
  }
});
