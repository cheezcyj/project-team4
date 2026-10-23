import type { AssistantAnswer } from "./types";

type BoundaryReply = Pick<AssistantAnswer, "kind" | "answer">;

// 제한된 한국어 경계 규칙이에요. 의료 위험 분류기나 진단 도구로 검증된 것은 아니에요.
// 도움 경로의 근거와 해석 한계: docs/research/assistant_eval_v1/SAFETY_SOURCES.md
const urgentSignals = [
  /의식(?:이|을|은|도)?(?:갑자기)?(?:없|잃|소실)/gu,
  /(?:깨워도|불러도|흔들어도)(?:반응(?:이|은)?없|일어나지않|대답(?:이|은)?없)/gu,
  /(?:숨(?:을|이)?(?:잘|제대로)?(?:못쉬|안쉬|쉬기(?:가)?(?:힘들|어렵|어려워)|멎|막히|막혀)|호흡(?:이|을)?(?:곤란|안되|멎))/gu,
  /(?:가슴(?:이|을|에|은)?(?:갑자기|너무|꽉|심하게)?(?:아파|아프|조이|조여|눌리|짓눌|답답)|(?:심한|갑작스런)?흉통|가슴(?:통증|압박))/gu,
];
const deniedTail = /^(?:지는?않|진않|는(?:건|것은|것이)아니|(?:은|는|이|가|도)?(?:전혀)?없|(?:이|가)?아니)/u;
const conditionalTail = /^(?:(?:이|가|을|를|은|는)?(?:있|없|생기|나타나|발생하))?(?:었|았)?(?:으?면|을때|는경우)/u;

function reportedUrgency(question: string): boolean {
  for (const sentence of question.split(/[.!?。！？;\n]+|하지만|그런데|(?<=지만)/u)) {
    const clause = sentence.replace(/\s+/gu, "");
    // 용어·가정 설명과 이미 끝난 증상을 현재의 신고 요청으로 바꾸지 않아요.
    if (/안내문|예문|문구|(?:단어|용어|표현)(?:의)?(?:뜻|의미)|(?:흉통|호흡곤란|의식소실)(?:이란|이뭐|은뭐)/u.test(clause)) continue;
    if (/(?:어제|지난|예전|작년)/u.test(clause) && /(?:지금|현재|이제)은?(?:괜찮|없|회복)/u.test(clause)) continue;
    for (const pattern of urgentSignals) {
      for (const match of clause.matchAll(pattern)) {
        const tail = clause.slice(match.index! + match[0].length);
        if (deniedTail.test(tail) || conditionalTail.test(tail)) continue;
        // '흉통', '호흡곤란' 같은 명사만 등장한 일반 질문은 응급 상황으로 단정하지 않아요.
        if (/(?:흉통|호흡곤란|의식소실|가슴통증|가슴압박)$/u.test(match[0])
          && !/(?:지금|현재|방금|갑자기|계속|있어|있는데|있습니다|생겼|느껴)/u.test(clause)) continue;
        return true;
      }
    }
  }
  return false;
}

export function medicalBoundary(question: string): BoundaryReply | null {
  const normalized = question.normalize("NFKC").toLocaleLowerCase("ko").replace(/\p{Cf}/gu, "");
  const compact = normalized.replace(/\s+/gu, "");
  if (reportedUrgency(normalized)) {
    return { kind: "safety", answer: "지금 바로 119에 연락해 도움을 요청하세요. 채팅 답변을 기다리지 말고 119 상담원의 안내를 따라 주세요. 이 도우미는 현재 상황의 진단이나 응급 처치를 대신할 수 없어요." };
  }
  const medication = /인슐린|당뇨약|혈당강하제|약물|복용약|(?:먹는|처방받은)약|약(?:을|은|이|의|도|용량|끊|늘|줄|빼|중단|감량|증량|먹|안먹|그만)/u;
  const changeTreatment = /용량|몇단위|얼마(?:나|를|정도)?(?:더)?(?:맞|투여|주사)|끊|중단|줄(?:여|이|일|였)|늘(?:려|리|릴|렸)|높(?:여|이|일)|낮(?:춰|추|출)|감량|증량|안먹|안맞|빼도|생략|그만|거르|걸러|건너뛰|반으로|두배/u;
  if (medication.test(compact) && changeTreatment.test(compact)) {
    return { kind: "safety", answer: "약·인슐린의 중단 여부나 투여량은 이 도우미가 정할 수 없어요. 치료 변경은 처방한 의료진에게 확인해 주세요." };
  }
  if (/진단해|진단부탁|당뇨(?:병)?(?:이|가)?(?:확정|맞아|맞나요|인가요|일까)/u.test(compact)) {
    return { kind: "safety", answer: "증상이나 수치만으로 당뇨병 여부를 이 도우미가 진단할 수는 없어요. 측정 상황과 증상을 의료진에게 알려 개인별 평가를 받아 주세요." };
  }
  // 숫자·소수·전각 수치와 일부 한글 수치 표현을 인식하되 기간 질문과 구분해요.
  const numericMeasurement = /(?:혈당|당화혈색소|hba1c)(?:(?:검사|측정)?(?:결과|수치|값))?(?:가|이|은|는)?[:=]?[+-]?\d{1,4}(?:\.\d+)?(?![\d.])(?!(?:개)?(?:초|분|시간|일|주|개월|달|년)|[~–-]\d)/u;
  const spokenMeasurement = /(?:혈당|당화혈색소|hba1c)(?:(?:검사|측정)?(?:결과|수치|값))?(?:가|이|은|는)?[:=]?(?:(?:[일이삼사오육칠팔구]?[천백십])+(?:[일이삼사오육칠팔구])?|[영공일이삼사오육칠팔구](?=점|밀리|mmol|mg|이야|예요|이에요|나왔|%))(?:점[영공일이삼사오육칠팔구]+)?(?!(?:개)?(?:초|분|시간|일|주|개월|달|년))/u;
  if (numericMeasurement.test(compact) || spokenMeasurement.test(compact)) {
    return { kind: "unsupported", answer: "입력하신 수치의 정상 여부나 개인 치료 목표는 이 도우미에서 판단하지 않아요. 측정 상황과 함께 기록에 남기고, 개인별 해석은 의료진에게 확인해 주세요." };
  }
  return null;
}
