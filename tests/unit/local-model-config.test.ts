import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { connectionEnvironment, localModelConfig, modelArguments, publicModelPrompt } from "../../scripts/lib/local-model-config.mjs";

const paths = ["--binary", ".local/runtime/llama-server", "--model", ".local/models/example.gguf"];

test("local model launcher derives the unchanged instruction literal and rejects dynamic content", () => {
  const source = readFileSync("src/lib/assistant/model.ts", "utf8");
  const prompt = publicModelPrompt(source);
  assert.equal(prompt, source.match(/const systemPrompt = `([^`]+)`;/)![1].replace(/\r\n/g, "\n"));
  assert.match(prompt, /확인 항목은 빠짐없이/);
  for (const invalid of ["missing", "const systemPrompt = `text ${privateValue}`;", "const systemPrompt = `escaped\\ntext`;", "const systemPrompt = getPrivateData();"]) assert.throws(() => publicModelPrompt(invalid));
});

test("launcher uses two loopback ports and retains credentials in a key file rather than argv", () => {
  const config = localModelConfig([...paths, "--port", "12480", "--upstream-port", "12481", "--threads", "2"], process.cwd(), {});
  assert.equal(config.port, 12480); assert.equal(config.upstreamPort, 12481);
  assert.equal(config.binary, path.resolve(paths[1]));
  const args = modelArguments(config, ".local/test-key", ".local/test-cache");
  assert.equal(args[args.indexOf("--host") + 1], "127.0.0.1");
  assert.equal(args[args.indexOf("--api-key-file") + 1], ".local/test-key");
  assert.equal(args[args.indexOf("--parallel") + 1], "1");
  assert.equal(args[args.indexOf("--cache-ram") + 1], "0");
  const key = "a".repeat(64), env = connectionEnvironment(config, key);
  assert(!args.includes(key));
  assert(env.includes("http://127.0.0.1:12480/v1"));
  assert(env.includes("ASSISTANT_ALLOW_DRAFT_PREVIEW=0"));
  assert(!env.includes(config.model!));
  assert(!env.includes("SUPABASE"));
  assert.throws(() => connectionEnvironment(config, "bad\nINJECTED=1"));
});

test("invalid ports, malformed resource settings and unknown flags fail before starting any processes", () => {
  for (const extra of [["--port", "11481"], ["--port", "80"], ["--port", "65536"], ["--port", "NaN"], ["--threads", "0"], ["--threads", "1.5"], ["--gpu-layers", "1\nX=1"], ["--host", "0.0.0.0"]]) {
    assert.throws(() => localModelConfig([...paths, ...extra], process.cwd(), {}));
  }
  assert.throws(() => localModelConfig([], process.cwd(), {}));
  assert.deepEqual(localModelConfig(["--help"], process.cwd(), {}), { help: true });
});
