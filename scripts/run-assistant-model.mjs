import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectionEnvironment, localModelConfig, modelArguments, publicModelPrompt } from "./lib/local-model-config.mjs";
import { createPrefixGateway } from "./lib/model-prefix-gateway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local/assistant-model");
const lockPath = path.join(local, "launcher.lock");
const run = randomUUID();
let child, gateway, cacheDirectory, output, stopping = false, ownsLock = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reserveLauncher() {
  await mkdir(local, { recursive: true });
  try {
    const previous = JSON.parse(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(previous.pid) || previous.pid < 1 || previous.owner !== "local-model-launcher") throw new Error("실행 잠금 파일을 확인해 주세요.");
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
    if (alive) throw new Error("이 폴더의 모델 실행기가 이미 켜져 있어요. 기존 실행기를 먼저 종료해 주세요.");
    await rm(lockPath);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const lock = await open(lockPath, "wx", 0o600);
  try { await lock.writeFile(JSON.stringify({ owner: "local-model-launcher", run, pid: process.pid })); ownsLock = true; }
  finally { await lock.close(); }
}

async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`${port} 포트가 사용 중이에요. 기존 서버를 종료하거나 --port와 --upstream-port를 바꿔 주세요.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway?.server.closeAllConnections(); gateway?.server.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await delay(50);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  output?.end();
  // Delete only this run's public checkpoint; never recursively remove model or experiment folders.
  if (cacheDirectory && path.dirname(cacheDirectory) === local && path.basename(cacheDirectory).startsWith("cache-")) {
    await rm(path.join(cacheDirectory, "public-instructions.bin"), { force: true }).catch(() => undefined);
    await rmdir(cacheDirectory).catch(() => undefined);
  }
  if (ownsLock) {
    const saved = await readFile(lockPath, "utf8").then(text => JSON.parse(text)).catch(() => ({}));
    if (saved.run === run) await rm(lockPath);
  }
  process.exit(code);
}

async function main() {
  const config = localModelConfig(process.argv.slice(2), root);
  if (config.help) {
    console.log("npm run assistant:model -- --binary <llama-server 파일> --model <GGUF 파일> [--port 11480] [--upstream-port 11481] [--threads 4] [--gpu-layers 0]\n다운로드한 파일을 지정하세요. 모델과 실행 파일은 자동으로 다운로드하지 않아요.");
    return;
  }
  try { await access(config.binary); await access(config.model); }
  catch { throw new Error("실행 파일 또는 GGUF 파일을 찾을 수 없어요. 지정한 경로를 확인해 주세요."); }
  const publicPrompt = publicModelPrompt(await readFile(path.join(root, "src/lib/assistant/model.ts"), "utf8"));
  await reserveLauncher();
  await assertFree(config.port); await assertFree(config.upstreamPort);
  const keyFile = path.join(local, "api-key");
  try { await writeFile(keyFile, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const apiKey = (await readFile(keyFile, "utf8")).trim();
  const environment = connectionEnvironment(config, apiKey);
  cacheDirectory = await mkdtemp(path.join(local, "cache-"));
  output = createWriteStream(path.join(local, "runtime.log"), { flags: "a", mode: 0o600 });
  child = spawn(config.binary, modelArguments(config, keyFile, cacheDirectory), { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  child.once("error", () => { console.error("모델 실행에 실패했어요. .local/assistant-model/runtime.log를 확인해 주세요."); void stop(1); });
  child.once("exit", () => { if (!stopping) { console.error("모델이 종료됐어요. 실행 파일 버전과 로컬 로그를 확인해 주세요."); void stop(1); } });
  const upstream = `http://127.0.0.1:${config.upstreamPort}`;
  console.log("모델을 불러오는 중이에요.");
  let loaded = false;
  for (let i = 0; i < 240 && !stopping; i++) {
    try { const r = await fetch(`${upstream}/health`, { signal: AbortSignal.timeout(1000) }); await r.body?.cancel(); if (r.ok) { loaded = true; break; } } catch { /* 모델 로딩 중에만 재확인합니다. */ }
    await delay(500);
  }
  if (!loaded) throw new Error("모델 준비 시간이 길어졌어요. 로컬 로그를 확인해 주세요.");
  gateway = createPrefixGateway({ apiKey, publicPrompt, upstream });
  await new Promise((resolve, reject) => { gateway.server.once("error", reject); gateway.server.listen(config.port, "127.0.0.1", resolve); });
  console.log("공통 안내문을 준비하는 중이에요. 이 단계에서는 개인 질문을 사용하지 않아요.");
  await gateway.initialize();
  await writeFile(path.join(local, "connection.env"), environment, { mode: 0o600 });
  console.log(`모델 연결 준비가 끝났어요: http://127.0.0.1:${config.port}/v1\n다른 터미널에서 npm run dev:assistant를 실행하세요. 종료는 Ctrl+C입니다.`);
  setInterval(() => {
    if (!gateway.state().ready && !gateway.state().busy) { console.error("안전한 모델 정리를 확인하지 못했어요. 실행기를 다시 시작해 주세요."); void stop(1); }
  }, 5000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void stop(); });
main().catch(error => { console.error(error.code ? "실행 설정을 확인하지 못했어요. --help와 로컬 로그를 확인해 주세요." : error.message); void stop(1); });
