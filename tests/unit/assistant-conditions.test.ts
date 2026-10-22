import assert from "node:assert/strict";
import test from "node:test";
import { supplementAnswer } from "../../src/lib/assistant/answer-conditions";
import { eligibleKnowledge } from "../../src/lib/assistant/knowledge";

test("missing nutrition and exercise conditions are supplemented only from actually cited eligible summaries", () => {
  const matches = eligibleKnowledge(true);
  for (const id of ["N02", "N03", "N04", "X01", "X02"]) {
    const match = matches.find(item => item.entry.id === id)!;
    const citations = match.citations.map(citation => citation.id);
    const result = supplementAnswer("짧아서 확인 조건이 빠진 답변이에요.", citations, matches);
    assert.equal(result.sourceSupplemented, true);
    assert.match(result.answer, /참고 자료의 확인 사항/);
    assert.ok(result.answer.endsWith(match.entry.summary));
    assert.deepEqual(supplementAnswer(result.answer, citations, matches), { answer: result.answer, sourceSupplemented: false });
  }
  assert.deepEqual(supplementAnswer("설명", [], matches), { answer: "설명", sourceSupplemented: false });
  const basic = matches.find(item => item.entry.id === "B01")!;
  assert.deepEqual(supplementAnswer("당시 값과 장기간 상태는 달라요.", basic.citations.map(c => c.id), matches),
    { answer: "당시 값과 장기간 상태는 달라요.", sourceSupplemented: false });
});

test("long output uses complete cited source summaries, preserving conditions within the answer size limit", () => {
  const matches = eligibleKnowledge(true);
  const match = matches.find(item => item.entry.id === "N03")!;
  const result = supplementAnswer("가".repeat(1999), match.citations.map(c => c.id), matches);
  assert.equal(result.answer, `참고 자료 요약: ${match.entry.summary}`);
  assert.ok(result.answer.length <= 2000);
});
