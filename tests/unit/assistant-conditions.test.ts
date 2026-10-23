import assert from "node:assert/strict";
import test from "node:test";
import { supplementAnswer } from "../../src/lib/assistant/answer-conditions";
import { eligibleKnowledge } from "../../src/lib/assistant/knowledge";

test("missing conditions are supplemented only from actually cited eligible summaries", () => {
  const matches = eligibleKnowledge(true);
  for (const id of ["B03", "N02", "N03", "N04", "X01", "X02", "X04"]) {
    const match = matches.find(item => item.entry.id === id)!;
    const citations = match.citations.map(citation => citation.id);
    const result = supplementAnswer("짧아서 확인 조건이 빠진 답변이에요.", citations, matches);
    assert.equal(result.sourceSupplemented, true);
    assert.match(result.answer, /참고 자료(?:의 확인 사항| 요약)/);
    assert.ok(result.answer.endsWith(match.entry.summary));
    assert.deepEqual(supplementAnswer(result.answer, citations, matches), { answer: result.answer, sourceSupplemented: false });
  }
  assert.deepEqual(supplementAnswer("설명", [], matches), { answer: "설명", sourceSupplemented: false });
  const basic = matches.find(item => item.entry.id === "B01")!;
  assert.deepEqual(supplementAnswer("당시 값과 장기간 상태는 달라요.", basic.citations.map(c => c.id), matches),
    { answer: "당시 값과 장기간 상태는 달라요.", sourceSupplemented: false });
});

test("live-review omissions and contradictory definitions fall back to actually cited conditions", () => {
  const matches = eligibleKnowledge(true);
  const omissions = [
    ["B03", "혈당 측정 시 날짜, 시간과 함께 당시 드신 음식이나 활동 정보를 메모하면 의료진이 기록을 볼 때 큰 도움이 돼요. 이 정보들은 혈당 변화의 원인을 파악하는 데 중요한 단서가 되기 때문이에요. 다만, 자유롭게 적은 메모만으로 실제 음식 섭취량을 정확히 확정할 수는 없다는 점을 기억해 주세요."],
    ["N03", "무가당이라고 해서 당류가 전혀 없다는 뜻은 아니에요. '무가당' 표시는 제조나 원재료에 당류 등을 넣지 않았다는 조건에 관한 표시이기 때문이에요. 정확한 확인을 위해서는 영양정보에서 당류, 탄수화물, 열량과 함께 표시 기준량을 꼭 확인하고 실제 드실 양도 고려해 보셔야 해요."],
    ["N03", "아니요, '무가당'이라고 해서 당류가 전혀 없다는 뜻은 아니에요. '무가당'은 제조하거나 원재료에 당류 등을 넣지 않았다는 조건에 대한 표시이기 때문이에요. 당류 함량이 0인지를 확인하려면 별도의 기준인 '무당' 여부를 확인해야 해요. 영양정보에서 당류, 탄수화물, 열량과 함께 표시된 기준량을 보고 실제로 드시는 양도 꼭 확인해 보세요."],
    ["N02", "당뇨가 있다고 해서 탄수화물을 아예 먹지 않는 것은 권장되지 않아요. 대신, 어떤 종류의 탄수화물을 얼마나 먹을지가 더 중요해요. 통곡물이나 콩류 같은 좋은 선택지를 포함해서 개인에게 맞는 식사 계획을 의료진이나 영양사와 함께 세우는 것이 필요해요."],
    ["N02", "당뇨가 있다고 해서 탄수화물을 아예 먹지 않는 것이 좋다고 단정하기보다는, 식품의 종류와 식이섬유를 함께 고려하는 것이 중요해요. 통곡물이나 콩류 같은 선택지를 포함하여 개인에게 맞는 식사 계획을 의료진이나 영양사와 상의하시는 것을 권장합니다."],
    ["X04", "새로운 운동을 시작하기 전에는 반드시 의료진과 상의해야 해요. 본인의 건강 상태, 복용 중인 약물, 그리고 식사 계획에 적합한 활동인지 확인하는 과정이 필요해요."],
  ];
  for (const [id, answer] of omissions) {
    const match = matches.find(item => item.entry.id === id)!;
    const citationIds = match.citations.map(citation => citation.id);
    const result = supplementAnswer(answer, citationIds, matches);
    assert.equal(result.sourceSupplemented, true, id);
    assert.ok(result.answer.includes(match.entry.summary), id);
    if (["B03", "N03"].includes(id)) {
      assert.equal(result.answer, `참고 자료 요약: ${match.entry.summary}`, "incomplete definitions must not remain beside the source summary");
      assert.ok(!result.answer.includes(answer));
    }
    assert.deepEqual(supplementAnswer(match.entry.summary, citationIds, matches),
      { answer: match.entry.summary, sourceSupplemented: false }, id);
    assert.deepEqual(supplementAnswer(answer, ["B01:R1"], matches),
      { answer, sourceSupplemented: false }, "uncited summaries must not be added");
  }
});

test("long output uses complete cited source summaries, preserving conditions within the answer size limit", () => {
  const matches = eligibleKnowledge(true);
  const match = matches.find(item => item.entry.id === "N03")!;
  const result = supplementAnswer("가".repeat(1999), match.citations.map(c => c.id), matches);
  assert.equal(result.answer, `참고 자료 요약: ${match.entry.summary}`);
  assert.ok(result.answer.length <= 2000);
});

test("sugar-label answers retain the numerical threshold and both reference units", () => {
  const matches = eligibleKnowledge(true);
  const match = matches.find(item => item.entry.id === "N03")!;
  const citations = match.citations.map(citation => citation.id);
  const liveOmission = "'무가당'은 당류 등을 넣지 않는 제조나 원재료의 조건일 뿐, 완제품의 당류가 0이라는 의미는 아니에요. 당류가 0g인지 확인하려면 '무당'이라는 별도의 함량 기준을 확인해야 하는데, 이 경우에도 정확히 0을 보장하지는 않아요. 영양정보에서 당류, 탄수화물, 열량과 표시 기준량을 확인하시고, 실제로 드시는 양도 함께 고려해 보셔야 해요.";
  const omissions = [liveOmission,
    match.entry.summary.replace("식품 100g 또는 100mL당 당류 0.5g 미만", "별도의 함량 기준"),
    match.entry.summary.replace("100g 또는 100mL당", "1회 제공량당"),
    match.entry.summary.replace("100g 또는 100mL당", "100g당"),
    match.entry.summary.replace("0.5g 미만", "0.5g 이하"),
    match.entry.summary.replace("0.5g 미만", "10.5g 미만"),
    match.entry.summary.replace("100g 또는 100mL", "1100g 또는 1100mL"),
  ];
  for (const answer of omissions) {
    assert.deepEqual(supplementAnswer(answer, citations, matches),
      { answer: `참고 자료 요약: ${match.entry.summary}`, sourceSupplemented: true });
    assert.deepEqual(supplementAnswer(answer, ["B01:R1"], matches), { answer, sourceSupplemented: false });
  }
});

test("complete sugar-label answers accept normalized spacing, unit case and full-width numbers", () => {
  const matches = eligibleKnowledge(true);
  const match = matches.find(item => item.entry.id === "N03")!;
  const citations = match.citations.map(citation => citation.id);
  for (const answer of [match.entry.summary,
    match.entry.summary.replace("100g 또는 100mL당 당류 0.5g 미만", "１００ g 또는 １００ ML당 당류 ０．５ 그램 미만"),
    match.entry.summary.replace("100g 또는 100mL당 당류 0.5g 미만", "100그램 또는 100밀리리터당 당류 0.5그램 미만"),
  ]) assert.deepEqual(supplementAnswer(answer, citations, matches), { answer, sourceSupplemented: false });
});
