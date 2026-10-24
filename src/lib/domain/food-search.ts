// 검색에서만 제외하고, 이미 저장한 식사의 음식명·영양정보는 보존해요.
export const FOOD_NAME_EXCLUSION_PATTERN = "^[[:space:]]*[?？]";

export function isSearchableFoodName(name: string): boolean {
  return !/^\s*[?？]/u.test(name);
}

// 앞쪽 100개를 섞는 대신 전체 후보에서 중복 없이 뽑아요. 원본 순서는 바꾸지 않아요.
export function randomFoodSample<T>(items: readonly T[], limit = 100, random = Math.random): T[] {
  const pool = [...items];
  const size = Math.min(limit, pool.length);
  for (let index = 0; index < size; index++) {
    const selected = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[selected]] = [pool[selected], pool[index]];
  }
  return pool.slice(0, size);
}
