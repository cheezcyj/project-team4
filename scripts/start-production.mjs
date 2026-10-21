import { spawn } from "node:child_process";
import { productionCommand } from "./production-command.mjs";

// 로컬 실행은 외부 공개 없이 시작해요. 클라우드 공개 주소와 포트는 배포 설정에서 따로 정해요.
const child = spawn(process.execPath, productionCommand(), {
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: process.env.PORT || "3000" }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
