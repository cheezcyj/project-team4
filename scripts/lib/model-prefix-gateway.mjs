import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const checkpoint = "public-instructions.bin";
const acceptedFields = new Set(["model", "stream", "temperature", "max_tokens", "cache_prompt", "chat_template_kwargs", "reasoning_effort", "response_format", "messages"]);
const digest = value => createHash("sha256").update(value).digest();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function limitedJson(stream, limit = 65_536) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > limit) throw new Error("Payload limit exceeded.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createPrefixGateway({ apiKey, publicPrompt, upstream = "http://127.0.0.1:11481", fetchImpl = fetch, timeoutMs = 90_000 }) {
  const url = new URL(upstream);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("A loopback model endpoint is required.");
  if (!apiKey || typeof publicPrompt !== "string" || publicPrompt.length < 100) throw new Error("Model authentication and public instructions are required.");
  const expectedAuth = digest(`Bearer ${apiKey}`);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  let ready = false, busy = false, prefixTokens = [];
  async function call(path, body, signal = AbortSignal.timeout(timeoutMs)) {
    const response = await fetchImpl(`${url.origin}${path}`, {
      method: body === undefined ? "GET" : "POST", headers, redirect: "error", cache: "no-store", signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await limitedJson(response.body, 262_144);
    if (!response.ok) throw new Error("Model request failed.");
    return result;
  }
  async function erase() {
    // The CPU runtime handles cancellation/control only after its current batch.
    // Keep the connection exclusively locked until that batch and cleanup finish.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await call("/slots/0?action=erase", {}, AbortSignal.timeout(30_000)); return; }
      catch { if (attempt === 1) throw new Error("Model cleanup failed."); await pause(200); }
    }
  }
  async function initialize() {
    if (busy) throw new Error("The model is busy.");
    ready = false; busy = true;
    try {
      await erase();
      // Both messages here are public constants. No incoming request is used to save a checkpoint.
      const formatted = await call("/apply-template", { messages: [
        { role: "system", content: publicPrompt }, { role: "user", content: "public-prefix-warmup" },
      ], chat_template_kwargs: { enable_thinking: false } });
      const start = formatted.prompt.indexOf(publicPrompt);
      if (start < 0) throw new Error("Unsupported model template.");
      const tokenized = await call("/tokenize", { content: formatted.prompt.slice(0, start + publicPrompt.length), add_special: true, parse_special: true });
      // Leave a boundary margin so adjoining text cannot change the last cached token.
      prefixTokens = tokenized.tokens.slice(0, -8);
      if (prefixTokens.length < 32 || !prefixTokens.every(Number.isInteger)) throw new Error("Invalid public prefix.");
      const warm = await call("/completion", { prompt: prefixTokens, n_predict: 0, cache_prompt: true, id_slot: 0 });
      if (warm.tokens_cached !== prefixTokens.length) throw new Error("Incomplete public prefix.");
      const saved = await call("/slots/0?action=save", { filename: checkpoint });
      if (saved.n_saved !== prefixTokens.length) throw new Error("Incomplete public checkpoint.");
      await erase();
      ready = true;
    } finally { busy = false; }
  }
  async function complete(body, signal) {
    let result;
    try {
      await erase();
      let reusable = body.messages[0]?.role === "system" && body.messages[0].content.startsWith(`${publicPrompt}\n`);
      if (reusable) {
        const formatted = await call("/apply-template", body, signal);
        const tokenized = await call("/tokenize", { content: formatted.prompt, add_special: true, parse_special: true }, signal);
        reusable = prefixTokens.every((token, index) => tokenized.tokens[index] === token);
      }
      if (reusable) {
        try {
          const restored = await call("/slots/0?action=restore", { filename: checkpoint }, signal);
          if (restored.n_restored !== prefixTokens.length) throw new Error("Public checkpoint unavailable.");
        } catch {
          // A model restart loses its temporary checkpoint. Restart this connection and warm it again.
          ready = false;
          throw new Error("Public checkpoint unavailable.");
        }
      }
      // Every original prompt, history, source, sampler and response constraint remains unchanged.
      result = await call("/v1/chat/completions", { ...body, cache_prompt: reusable, id_slot: 0 }, signal);
    } finally {
      try { await erase(); }
      catch { ready = false; throw new Error("Model cleanup failed."); }
    }
    return result;
  }
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      if (response.destroyed) return;
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && request.url === "/health") return send(ready ? 200 : 503, { ready });
    if (!timingSafeEqual(digest(request.headers.authorization ?? ""), expectedAuth)) return send(401, { error: "Unauthorized" });
    if (request.method === "GET" && request.url === "/v1/models") {
      try { return send(200, await call("/v1/models")); } catch { return send(503, { error: "Model unavailable" }); }
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") return send(404, { error: "Not found" });
    if (!ready || busy) return send(503, { error: "Model unavailable" });
    busy = true;
    const cancel = new AbortController();
    const disconnect = () => { if (!response.writableEnded) cancel.abort(); };
    response.once("close", disconnect);
    const timer = setTimeout(() => request.destroy(), 5000);
    try {
      const body = await limitedJson(request);
      clearTimeout(timer);
      if (!body || Object.keys(body).some(key => !acceptedFields.has(key)) || body.stream !== false || !Array.isArray(body.messages)
        || body.messages.length < 2 || body.messages.length > 6
        || body.messages.some(message => !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string")) {
        return send(400, { error: "Invalid model request" });
      }
      const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(timeoutMs)]);
      send(200, await complete(body, signal));
    } catch { send(503, { error: "Model unavailable" }); }
    finally { clearTimeout(timer); response.removeListener("close", disconnect); busy = false; }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return { server, initialize, state: () => ({ ready, busy, publicTokens: prefixTokens.length }) };
}
