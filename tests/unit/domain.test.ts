import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRecordsAscending,
  dayRange,
  isTimestamp,
  isoToSeoulInput,
  recentRange,
  recordInRange,
  seoulDay,
  seoulInputToIso,
  validateRecord,
  type GlucoseRecord,
} from "../../src/lib/domain";

const valid = {
  glucose_mg_dl: 110,
  measured_at: "2026-10-20T00:30:00.000Z",
  measurement_context: "fasting",
  meal_memo: null,
};

test("Seoul recent seven calendar days includes lower midnight and excludes next midnight", () => {
  const range = recentRange("2026-10-20T15:00:00.000Z");
  assert.deepEqual(range, {
    start: "2026-10-14T15:00:00.000Z",
    end: "2026-10-21T15:00:00.000Z",
    label: "2026-10-15 ~ 2026-10-21",
  });
  const row = { ...valid, measured_at: range.start } as GlucoseRecord;
  assert.equal(recordInRange(row, range), true);
  assert.equal(recordInRange({ ...row, measured_at: range.end }, range), false);
  assert.equal(recordInRange({ ...row, measured_at: "2026-10-14T14:59:59.999Z" }, range), false);
});

test("Seoul conversion is independent of server local time and validates impossible dates", () => {
  assert.equal(seoulDay("2026-12-31T15:00:00Z"), "2027-01-01");
  assert.deepEqual(dayRange("2024-02-29"), {
    start: "2024-02-28T15:00:00.000Z",
    end: "2024-02-29T15:00:00.000Z",
    label: "2024-02-29",
  });
  assert.throws(() => dayRange("2026-02-29"));
  assert.throws(() => dayRange("2026-2-01"));
  assert.equal(seoulInputToIso("2026-10-20T09:30"), "2026-10-20T00:30:00.000Z");
  assert.equal(isoToSeoulInput("2026-10-20T00:30:00.000Z"), "2026-10-20T09:30");
  assert.equal(seoulInputToIso("2026-02-30T09:30"), null);
  assert.equal(isTimestamp("2026-02-30T00:00:00Z"), false);
  assert.equal(isTimestamp("2026-10-20T24:00:00Z"), false);
  assert.equal(isTimestamp("2026-10-20T12:60:00Z"), false);
  assert.equal(isTimestamp("2026-10-20T12:00:00"), false);
  assert.equal(isTimestamp("2026-10-20T12:00:00.123456+09:00"), true);
});

test("glucose boundaries are storage constraints, with no medical upper cutoff", () => {
  for (const value of [1, 2_147_483_647, "110"]) {
    assert.equal(validateRecord({ ...valid, glucose_mg_dl: value }).ok, true);
  }
  for (const value of ["", "1.0", " 1 ", "1e2", "혈당", 0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    const result = validateRecord({ ...valid, glucose_mg_dl: value });
    assert.equal(result.ok, false, String(value));
    if (!result.ok) assert.ok(result.fields.glucose_mg_dl);
  }
});

test("memo trims empty to null and counts Unicode code points rather than UTF-16 units", () => {
  const empty = validateRecord({ ...valid, meal_memo: " \n\t " });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.meal_memo, null);
  assert.equal(validateRecord({ ...valid, meal_memo: "🍎".repeat(500) }).ok, true);
  assert.equal(validateRecord({ ...valid, meal_memo: "🍎".repeat(501) }).ok, false);
  assert.equal(validateRecord({ ...valid, meal_memo: 123 }).ok, false);
  assert.equal(validateRecord({ ...valid, measurement_context: "diagnosis" }).ok, false);
});

test("equal measurement timestamps preserve distinct records using UUID ordering", () => {
  const first = { ...valid, id: "10000000-0000-4000-8000-000000000001" } as GlucoseRecord;
  const second = { ...valid, id: "10000000-0000-4000-8000-000000000002" } as GlucoseRecord;
  assert.ok(compareRecordsAscending(first, second) < 0);
  assert.deepEqual([second, first].sort(compareRecordsAscending), [first, second]);
});
