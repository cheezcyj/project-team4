import { cpSync, existsSync } from "node:fs";
import path from "node:path";

// Next.js의 단독 실행본에 CSS·브라우저용 파일을 함께 놓아, 빌드한 화면이 정상 표시되게 해요.
export function productionCommand() {
  const directory = process.env.NEXT_DIST_DIR || ".next";
  const server = path.resolve(directory, "standalone/server.js");
  if (!existsSync(server)) throw new Error("먼저 npm run build를 실행해 주세요.");
  cpSync(path.join(directory, "static"), path.join(directory, "standalone", directory, "static"), { recursive: true });
  return [server];
}
