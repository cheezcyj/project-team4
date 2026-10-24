import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createPrefixGateway } from "../../scripts/lib/model-prefix-gateway.mjs";

const publicPrompt = "공개된 공통 안내문입니다. ".repeat(20);
const publicTokens = Array.from({ length: 60 }, (_, n) => n + 1);
type Body = Record<string, unknown>;
async function fixture() {
  const calls: { path: string; body?: Body }[] = [];
  let saved = 0, privateState = false, failErase = false, lostCheckpoint = false;
  let generate: (body: Body, signal: AbortSignal) => Promise<unknown> = async () => ({ choices: [{ message: { content: '{"answer":"답변","citation_ids":["public"]}' } }] });
  const gateway = createPrefixGateway({ apiKey: "test-only-key", publicPrompt, fetchImpl: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname + url.search;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    let result;
    if (path.includes("action=erase")) {
      if (failErase) return Response.json({}, { status: 500 });
      privateState = false; result = { n_erased: 100 };
    } else if (path === "/apply-template") result = { prompt: `prefix:${body.messages[0].content}` };
    else if (path === "/tokenize") result = { tokens: [...publicTokens, ...Array(8).fill(0)] };
    else if (path === "/completion") {
      assert.deepEqual(body.prompt, publicTokens);
      assert.equal(privateState, false);
      result = { tokens_cached: publicTokens.length };
    } else if (path.includes("action=save")) {
      assert.equal(privateState, false, "No user state may ever be saved.");
      saved++; result = { n_saved: publicTokens.length };
    } else if (path.includes("action=restore")) {
      if (lostCheckpoint) return Response.json({}, { status: 500 });
      assert.equal(privateState, false, "Erase before restoring the public checkpoint.");
      result = { n_restored: publicTokens.length };
    } else if (path === "/v1/chat/completions") {
      assert.equal(privateState, false, "No preceding request state may survive.");
      privateState = true; result = await generate(body, init.signal as AbortSignal);
    } else if (path === "/v1/models") result = { data: [{ id: "test-model" }] };
    else throw Error("Unexpected endpoint");
    return Response.json(result);
  } });
  await gateway.initialize();
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const address = gateway.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    ...gateway, calls, base,
    saved: () => saved, privateState: () => privateState,
    failErase: () => { failErase = true; },
    loseCheckpoint: () => { lostCheckpoint = true; },
    generate: (fn: typeof generate) => { generate = fn; },
    request: (body: Body, signal?: AbortSignal) => fetch(`${base}/v1/chat/completions`, {
      method: "POST", headers: { Authorization: "Bearer test-only-key", "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    }),
    close: async () => { gateway.server.closeAllConnections(); await new Promise<void>(resolve => gateway.server.close(() => resolve())); },
  };
}
function body(marker: string): Body {
  return { model: "test-model", stream: false, temperature: 0.1, max_tokens: 512, cache_prompt: false,
    response_format: { type: "json_object", schema: { type: "object" } },
    chat_template_kwargs: { enable_thinking: false }, reasoning_effort: "none",
    messages: [{ role: "system", content: `${publicPrompt}\n출처 목록` }, { role: "user", content: marker }],
  };
}

test("public prefix reuse preserves every message and generation constraint and isolates consecutive users", async () => {
  const f = await fixture();
  try {
    for (const marker of ["synthetic-user-A", "synthetic-user-B"]) {
      const input = body(marker);
      const response = await f.request(input);
      assert.equal(response.status, 200);
      assert.equal(f.privateState(), false, "Cleanup finishes before returning the answer.");
      const sent = f.calls.filter(x => x.path === "/v1/chat/completions").at(-1)!.body;
      assert.deepEqual(sent, { ...input, cache_prompt: true, id_slot: 0 });
    }
    assert.equal(f.saved(), 1, "Only the startup public prefix may be saved.");
    const checkpointCalls = f.calls.filter(x => x.path.includes("action=save") || x.path === "/completion");
    assert.doesNotMatch(JSON.stringify(checkpointCalls), /synthetic-user/);
  } finally { await f.close(); }
});

test("unrecognized prompt stays uncached and model controls cannot bypass the gateway", async () => {
  const f = await fixture();
  try {
    const input = body("synthetic-only");
    input.messages = [{ role: "system", content: "Changed instructions" }, { role: "user", content: "question" }];
    assert.equal((await f.request(input)).status, 200);
    assert.equal(f.calls.filter(x => x.path === "/v1/chat/completions").at(-1)!.body!.cache_prompt, false);
    assert.equal(f.privateState(), false);
    assert.equal((await f.request({ ...body("q"), prompt: "bypass" })).status, 400);
    assert.equal((await fetch(`${f.base}/slots/0?action=save`, { method: "POST", headers: { Authorization: "Bearer test-only-key" } })).status, 404);
    assert.equal((await fetch(`${f.base}/v1/models`)).status, 401);
    assert.equal(f.saved(), 1);
  } finally { await f.close(); }
});

test("concurrent requests cannot interleave checkpoint restoration and generation", async () => {
  const f = await fixture();
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>(r => { started = r; });
  f.generate(async () => { started(); await new Promise<void>(r => { release = r; }); return { ok: true }; });
  try {
    const first = f.request(body("first")); await began;
    assert.equal((await f.request(body("second"))).status, 503);
    release(); assert.equal((await first).status, 200);
    assert.equal(f.privateState(), false);
  } finally { release?.(); await f.close(); }
});

test("disconnect cancels generation and clears private state before another request", async () => {
  const f = await fixture();
  let started!: () => void;
  const began = new Promise<void>(r => { started = r; });
  f.generate(async (_body, signal) => { started(); await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true })); });
  try {
    const cancel = new AbortController();
    const response = f.request(body("private-cancel-marker"), cancel.signal).catch(() => undefined);
    await began; cancel.abort(); await response;
    for (let i = 0; i < 100 && f.state().busy; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.state().busy, false); assert.equal(f.privateState(), false);
    assert.equal(f.saved(), 1);
  } finally { await f.close(); }
});

test("upstream failure clears private state and cleanup failure closes the service to further requests", async () => {
  const f = await fixture();
  try {
    f.generate(async () => { throw Error("synthetic-private-error"); });
    const failed = await f.request(body("private-error"));
    assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /synthetic-private/);
    assert.equal(f.privateState(), false);
    f.generate(async () => { f.failErase(); return { ok: true }; });
    assert.equal((await f.request(body("cleanup-failure"))).status, 503);
    assert.equal(f.state().ready, false);
    const count = f.calls.length;
    assert.equal((await f.request(body("must-not-run"))).status, 503);
    assert.equal(f.calls.length, count);
  } finally { await f.close(); }
});

test("a lost checkpoint after a model restart stops requests until public warmup runs again", async () => {
  const f = await fixture();
  try {
    f.loseCheckpoint();
    assert.equal((await f.request(body("not-to-be-generated"))).status, 503);
    assert.equal(f.state().ready, false);
    assert.equal(f.privateState(), false);
    assert.equal(f.calls.some(call => call.path === "/v1/chat/completions"), false);
  } finally { await f.close(); }
});
