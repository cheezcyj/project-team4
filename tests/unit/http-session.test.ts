import assert from "node:assert/strict";
import test from "node:test";
import { assertSameOrigin, jsonBody } from "../../src/lib/server/http";
import { parseDemoSession, signDemoSession, assertLocalDemo } from "../../src/lib/server/session";
import { ApiError } from "../../src/lib/server/errors";

test("mutation origin checks reject missing or cross-origin input", () => {
  const request = (origin?: string, host = "127.0.0.1:3000") =>
    new Request("http://127.0.0.1:3000/api/records", {
      method: "POST",
      headers: { host, ...(origin ? { origin } : {}) },
    });
  assert.doesNotThrow(() => assertSameOrigin(request("http://127.0.0.1:3000")));
  assert.throws(() => assertSameOrigin(request()), ApiError);
  assert.throws(() => assertSameOrigin(request("https://another.example")), ApiError);
  assert.throws(() => assertSameOrigin(request("http://127.0.0.1:3001")), ApiError);
  assert.doesNotThrow(() => assertLocalDemo(request("http://127.0.0.1:3000")));
  assert.throws(() => assertLocalDemo(request("https://public.example", "public.example")), ApiError);
});

test("signed sessions reject tampering, expiry, other signing keys, and nonexistent users", () => {
  const secret = "a-long-test-secret-that-is-not-a-production-key";
  const now = Date.now();
  const token = signDemoSession({ account: "a", expires: now + 60_000 }, secret);
  assert.equal(parseDemoSession(token, secret, now)?.account, "a");
  assert.equal(parseDemoSession(`${token}a`, secret, now), null);
  assert.equal(parseDemoSession(token, "another-key", now), null);
  assert.equal(parseDemoSession(token, secret, now + 61_000), null);
  const forgedBody = Buffer.from(JSON.stringify({ account: "b", expires: now + 60_000 })).toString("base64url");
  assert.equal(parseDemoSession(`${forgedBody}.${token.split(".")[1]}`, secret, now), null);
});

test("JSON body rejects arrays, malformed payloads, and excessive actual content", async () => {
  const make = (text: string) =>
    new Request("http://localhost/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
  assert.deepEqual(await jsonBody(make('{"glucose_mg_dl":110}')), { glucose_mg_dl: 110 });
  await assert.rejects(jsonBody(make("[]")), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(jsonBody(make("{")), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(
    jsonBody(make(JSON.stringify({ memo: "x".repeat(20_000) }))),
    (error: unknown) => error instanceof ApiError && error.status === 413,
  );
});
