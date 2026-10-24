import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { normalizeFoodFile } from "./food-catalog-import.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** 네트워크·운영 DB 없이 저장소의 공개 음식 발췌본으로 공통 시연 자료를 준비합니다. */
export async function prepareDemoFoodCatalog(root = process.cwd()) {
  const sourceDirectory = path.join(root, "resources", "foods");
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));
  if (manifest.schema_version !== 1 || manifest.source_file !== "mfds-nutrition.csv"
    || !/^[0-9a-f]{64}$/.test(manifest.source_sha256) || !/^[0-9a-f]{64}$/.test(manifest.records_sha256)
    || !Number.isFinite(Date.parse(manifest.normalized_at))) throw new Error("음식 자료의 출처 정보를 확인해 주세요.");
  const source = await readFile(path.join(sourceDirectory, "mfds-nutrition.csv"));
  if (sha256(source) !== manifest.source_sha256) throw new Error("음식 CSV의 확인값이 달라요. 저장소의 원본 파일을 복원해 주세요.");
  const artifact = normalizeFoodFile(source, { sourceVersion: manifest.source_version, now: manifest.normalized_at });
  if (artifact.records_count !== manifest.records_count || artifact.records_sha256 !== manifest.records_sha256) {
    throw new Error("음식 변환 결과가 공통 발췌본과 달라요. 자료와 변환 도구의 버전을 확인해 주세요.");
  }
  const bytes = Buffer.from(JSON.stringify({ ...artifact, include_built_in: true }));
  const expected = sha256(bytes);
  const directory = path.join(root, ".local", "food-catalog");
  const filename = path.join(directory, `team-${manifest.source_sha256.slice(0, 16)}.json`);
  const verify = async () => {
    if (sha256(await readFile(filename)) !== expected) {
      throw new Error("공통 음식 캐시가 변경됐어요. .local/food-catalog의 해당 파일을 별도로 보관한 뒤 다시 실행해 주세요.");
    }
  };
  try { await verify(); return filename; } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(directory, { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    // 완성한 파일만 공개하고, 다른 실행이 먼저 만든 파일은 덮어쓰지 않습니다.
    try { await link(temporary, filename); } catch (error) { if (error.code !== "EEXIST") throw error; }
    await verify();
  } finally { await unlink(temporary).catch(() => undefined); }
  return filename;
}
