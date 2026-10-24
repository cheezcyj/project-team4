import { availableParallelism } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export function publicModelPrompt(source) {
  const match = /const systemPrompt = `([^`]+)`;/.exec(source.replace(/\r\n/g, "\n"));
  if (!match || match[1].includes("${") || match[1].includes("\\")) throw new Error("공통 안내문 형식이 변경됐어요. 연결 코드를 먼저 확인해 주세요.");
  return match[1];
}

/** @param {string[]} args @param {string} root @param {Record<string, string | undefined>} env */
export function localModelConfig(args, root, env = process.env) {
  const { values } = parseArgs({ args, options: {
    binary: { type: "string" }, model: { type: "string" }, port: { type: "string" },
    "upstream-port": { type: "string" }, threads: { type: "string" }, "gpu-layers": { type: "string" },
    help: { type: "boolean" },
  }, strict: true });
  if (values.help) return { help: true };
  const binary = values.binary || env.LLAMA_SERVER_PATH;
  const model = values.model || env.ASSISTANT_GGUF_PATH;
  if (!binary || !model) throw new Error("--binary에 llama-server 실행 파일, --model에 GGUF 파일을 지정해 주세요. --help로 예시를 볼 수 있어요.");
  const port = Number(values.port ?? 11480), upstreamPort = Number(values["upstream-port"] ?? 11481);
  const threads = Number(values.threads ?? Math.min(4, availableParallelism()));
  const gpuLayers = values["gpu-layers"] ?? "0";
  if (![port, upstreamPort].every(x => Number.isInteger(x) && x >= 1024 && x <= 65535) || port === upstreamPort) throw new Error("서로 다른 두 포트(1024~65535)를 지정해 주세요.");
  if (!Number.isInteger(threads) || threads < 1 || threads > 256) throw new Error("스레드 수는 1~256 사이의 정수여야 해요.");
  if (!/^(?:auto|\d{1,3})$/.test(gpuLayers)) throw new Error("GPU 레이어는 0~999 또는 auto로 지정해 주세요.");
  return { help: false, binary: path.resolve(root, binary), model: path.resolve(root, model), port, upstreamPort, threads, gpuLayers, alias: "local-health-model" };
}

export function modelArguments(config, keyFile, cacheDirectory) {
  return ["--model", config.model, "--alias", config.alias, "--host", "127.0.0.1", "--port", String(config.upstreamPort),
    "--ctx-size", "4096", "--parallel", "1", "--threads", String(config.threads), "--threads-batch", String(config.threads),
    "--batch-size", "1024", "--ubatch-size", "512", "--gpu-layers", config.gpuLayers,
    "--cache-ram", "0", "--no-cache-idle-slots", "--slot-save-path", cacheDirectory,
    "--jinja", "--reasoning", "off", "--reasoning-budget", "0", "--no-ui", "--api-key-file", keyFile];
}

export function connectionEnvironment(config, key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("로컬 모델 인증 파일 형식을 확인해 주세요.");
  return ["# Generated local connection settings. Do not share this file.", "ASSISTANT_ENABLED=1",
    `ASSISTANT_MODEL_BASE_URL=http://127.0.0.1:${config.port}/v1`, `ASSISTANT_MODEL=${config.alias}`,
    `ASSISTANT_MODEL_API_KEY=${key}`, "ASSISTANT_MODEL_RESPONSE_FORMAT=json_object", "ASSISTANT_MODEL_TIMEOUT_MS=90000",
    "ASSISTANT_ALLOW_DRAFT_PREVIEW=0", "ASSISTANT_PUBLIC_SOURCES_ENABLED=1", ""].join("\n");
}
