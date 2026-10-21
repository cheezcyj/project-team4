import type { BenefitRule, HealthArticle } from "@/lib/domain/service-types";
export { foodCatalog } from "./foods";

const checkedAt = "2026-10-21T00:00:00Z";
const reviewDueAt = "2026-11-21T00:00:00Z";
const registrationUrl = "https://www.kdca.go.kr/kdca/3361/subview.do";

// Policy summaries deliberately leave registration, prescriptions and district checks to the official agency.
export const benefitRules: BenefitRule[] = [
  {
    id: "00000002-0000-4000-8000-000000000001", name: "당뇨병환자 소모성재료 구입비", agency: "국민건강보험공단", region_scope: ["all"],
    criteria_json: { schema_version: 1, diagnosed: true, additional_requirements: ["공단 등록과 처방전, 구입 품목 및 등록업소 요건을 확인해 주세요.", "인슐린 투여가 원칙이나 만 19세 미만·임신 중에는 예외가 있어요. 본인 조건은 공단에 확인해 주세요."] },
    description: "혈당측정검사지와 채혈침 등 정해진 소모성재료 구입비를 지원하는 제도예요. 지원 품목과 금액은 진단 유형·연령·처방에 따라 달라요.",
    source_url: "https://www.nhis.or.kr/static/html/wbma/c/wbmac0208.html", source_key: "nhis-diabetes-consumables", version: 1, valid_from: null, valid_until: null, checked_at: checkedAt, review_due_at: reviewDueAt, status: "approved",
  },
  {
    id: "00000002-0000-4000-8000-000000000002", name: "당뇨병 관리기기 구입비", agency: "국민건강보험공단", region_scope: ["all"],
    criteria_json: { schema_version: 1, diagnosed: true, insulin_use: true, additional_requirements: ["제1형 당뇨병의 인정기준과 공단 등록 여부를 확인해 주세요. 제2형은 해당 급여에서 제외돼요.", "급여대상 등록 뒤 받은 처방전과 등록 제품·업소, 구입 시점 및 지급 주기를 확인해 주세요."] },
    description: "인슐린을 투여하는 등록된 제1형 당뇨병 환자의 연속혈당측정기와 인슐린자동주입기 구입을 지원하는 제도예요.",
    source_url: "https://www.nhis.or.kr/static/html/wbma/c/wbmac0230.html", source_key: "nhis-diabetes-devices", version: 1, valid_from: null, valid_until: null, checked_at: checkedAt, review_due_at: reviewDueAt, status: "approved",
  },
  {
    id: "00000002-0000-4000-8000-000000000003", name: "고혈압·당뇨병 등록관리사업", agency: "질병관리청·사업지역 보건소", region_scope: ["서울", "광주", "울산", "세종", "경기", "강원", "전북", "전남", "경북", "경남", "제주"],
    criteria_json: { schema_version: 1, min_age: 30, additional_requirements: ["고혈압 또는 당뇨병 진단과 주민등록상 사업지역 거주 여부를 보건소에 확인해 주세요.", "같은 시·도라도 일부 시·군·구만 사업지역이에요. 참여 의료기관과 등록 여부를 확인해 주세요.", "2026년 9월 30일 사업 개편 계획이 발표됐어요. 현재 지역별 서비스와 의료비 지원 여부는 보건소에서 확인해야 해요."] },
    description: "사업지역 주민에게 질환·영양·운동 교육과 상담, 진료 일정 알림을 제공해요. 지역과 연령별 지원 내용은 보건소 확인이 필요해요.",
    source_url: registrationUrl, source_key: "kdca-diabetes-registration", version: 1, valid_from: null, valid_until: null, checked_at: checkedAt, review_due_at: reviewDueAt, status: "approved",
  },
];

// News integration is deferred. Never populate the UI with sample articles.
export const healthArticles: HealthArticle[] = [];

export const catalogRights = [
  { source_key: "USDA-SR-Legacy-2018-04", license: "CC0-1.0", rights_url: "https://fdc.nal.usda.gov/", source_url: "https://fdc.nal.usda.gov/download-datasets/", checked_at: checkedAt, review_due_at: "2027-10-21T00:00:00Z", use_mode: "redistribute", note: "영양 원본 수치 유지, 식품명 한국어 번역. 100g 가식부 기준. 실제 조리법·제품과 다를 수 있음." },
  ...benefitRules.map(rule => ({ source_key: rule.source_key, license: "link_only", rights_url: rule.source_url, source_url: rule.source_url, checked_at: checkedAt, review_due_at: reviewDueAt, use_mode: "link_only", note: "공식 링크와 사실 기반의 짧은 자체 요약만 제공. 본문·이미지 재배포 안 함." })),
  ...healthArticles.map(article => ({ source_key: article.id, license: "link_only", rights_url: article.url, source_url: article.url, checked_at: checkedAt, review_due_at: reviewDueAt, use_mode: "link_only", note: "제목·기관·게시일·원문 링크만 제공. 본문·이미지 재배포 안 함." })),
] as const;
