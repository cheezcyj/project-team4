import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { productionCommand } from "./production-command.mjs";
import { prepareDemoFoodCatalog } from "./lib/demo-food-catalog.mjs";

// 시연 명령으로 실행할 때만 가상 계정을 켜고, 접속 주소는 이 컴퓨터로 제한해요.
const production = process.argv.includes("--production");
// 직접 지정한 실험 자료는 보존하고, 기본 실행은 팀 공통 음식 목록을 사용해요.
const foodCatalogFile = process.env.FOOD_CATALOG_FILE || await prepareDemoFoodCatalog();
const child = spawn(process.execPath, production ? productionCommand() : [
  path.resolve("node_modules/next/dist/bin/next"),
  "dev",
  "--hostname", "127.0.0.1",
  "--port", process.env.PORT || "3000"
], {
  stdio: "inherit",
  env: {
    ...process.env,
    APP_MODE: "demo",
    DEMO_WORKSPACE_ROOT: process.cwd(),
    FOOD_CATALOG_FILE: foodCatalogFile,
    HOSTNAME: "127.0.0.1",
    PORT: process.env.PORT || "3000",
    // 따로 지정하지 않았다면 실행마다 새 값을 써서 이전 시연 로그인 쿠키를 재사용하지 않아요.
    DEMO_SESSION_SECRET: process.env.DEMO_SESSION_SECRET || randomBytes(32).toString("hex"),
    NEXT_TELEMETRY_DISABLED: "1"
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", code => process.exit(code ?? 1));
