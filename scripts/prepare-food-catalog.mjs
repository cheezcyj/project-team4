import path from "node:path";
import { prepareDemoFoodCatalog } from "./lib/demo-food-catalog.mjs";

const filename = await prepareDemoFoodCatalog();
console.log(`공통 음식 자료를 준비했습니다: ${path.relative(process.cwd(), filename)}`);
console.log("식약처 50,000개 + 기본 8개. 선행 물음표 6개를 제외한 검색 목록은 50,002개입니다.");
