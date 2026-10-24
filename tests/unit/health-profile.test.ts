import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HEALTH_PROFILE_NOTICE_VERSION, isHealthProfile, validateHealthProfile, type HealthProfileInput,
} from "../../src/lib/domain/health-profile";
import { DEMO_USERS, DemoStore, validateDemoData } from "../../src/lib/server/demo-store";
import { ApiError } from "../../src/lib/server/errors";
import { getHealthProfile, removeHealthProfile, saveHealthProfile } from "../../src/lib/server/health-profile";
import { apiRoute } from "../../src/lib/server/http";
import type { RequestContext } from "../../src/lib/server/session";

const a = DEMO_USERS.a.id;
const b = DEMO_USERS.b.id;
const input: HealthProfileInput = {
  sex: "female", age: 30, height_cm: 162.5, weight_kg: 54.3,
  allow_storage: true, notice_version: HEALTH_PROFILE_NOTICE_VERSION, expected_updated_at: null,
};
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;
const context = (store: DemoStore, account: "a" | "b" = "a", consent: "current" | "outdated" | "missing" = "current"): RequestContext => ({
  store, session: { user: DEMO_USERS[account], mode: "demo", consent },
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(tmpdir(), "health-profile-test-"));
  const filename = path.join(directory, "demo.json");
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.match(path.basename(directory), /^health-profile-test-/);
    await rm(directory, { recursive: true, force: true });
  });
  return { filename, store: new DemoStore(filename) };
}

test("profile accepts partial values, exact boundaries, decimal tenths and age zero", () => {
  const empty = { ...input, sex: null, age: null, height_cm: null, weight_kg: null };
  for (const values of [{ sex: "other" }, { age: 0 }, { age: 120 }, { height_cm: 30 },
    { height_cm: 250 }, { height_cm: 173.1 }, { weight_kg: 1 }, { weight_kg: 500 }, { weight_kg: 64.7 }]) {
    assert.equal(validateHealthProfile({ ...empty, ...values }).ok, true, JSON.stringify(values));
  }
});

test("profile rejects invalid numeric types, fractions, range, blank save and missing consent/version", () => {
  for (const values of [{ sex: "unknown" }, { sex: ["female"] }, { age: -1 }, { age: 121 }, { age: 21.5 },
    { age: "21" }, { height_cm: 29.9 }, { height_cm: 250.1 }, { height_cm: 150.11 }, { height_cm: NaN },
    { weight_kg: 0 }, { weight_kg: 500.1 }, { weight_kg: 50.55 }, { weight_kg: Infinity },
    { allow_storage: false }, { allow_storage: "true" }, { allow_storage: undefined },
    { notice_version: "old" }, { notice_version: undefined }, { expected_updated_at: undefined },
    { expected_updated_at: "2026-02-30T10:00:00Z" }, { sex: null, age: null, height_cm: null, weight_kg: null }]) {
    assert.equal(validateHealthProfile({ ...input, ...values }).ok, false, JSON.stringify(values));
  }
  assert.equal(validateHealthProfile(null).ok, false);
  assert.equal(validateHealthProfile([]).ok, false);
});

test("service enforces authenticated owner, app consent, storage consent and immutable fields", async t => {
  const { store } = await fixture(t);
  const anonymous: RequestContext = { store, session: { user: null, mode: "demo", consent: null } };
  await assert.rejects(getHealthProfile(anonymous), code("UNAUTHORIZED"));
  await assert.rejects(saveHealthProfile(anonymous, input), code("UNAUTHORIZED"));
  await assert.rejects(removeHealthProfile(anonymous, { expected_updated_at: new Date().toISOString() }), code("UNAUTHORIZED"));
  await assert.rejects(saveHealthProfile(context(store, "a", "missing"), input), code("CONSENT_REQUIRED"));
  await assert.rejects(store.saveHealthProfile(a, input), code("CONSENT_REQUIRED"));
  await store.agree(a);
  await assert.rejects(saveHealthProfile(context(store), { ...input, user_id: b }), code("IMMUTABLE_FIELD"));
  await assert.rejects(saveHealthProfile(context(store), { ...input, allow_storage: false }), code("INVALID_INPUT"));
  await assert.rejects(saveHealthProfile(context(store), { ...input, notice_version: "outdated" }), code("INVALID_INPUT"));
  await assert.rejects(store.getHealthProfile("not-a-demo-account"), code("UNAUTHORIZED"));
  assert.equal(await getHealthProfile(context(store)), null);
});

test("save, partial update and delete survive new stores while isolating accounts", async t => {
  const { filename, store } = await fixture(t);
  await store.agree(a); await store.agree(b);
  const saved = await saveHealthProfile(context(store), input);
  assert.equal(isHealthProfile(saved, a), true);
  assert.equal(isHealthProfile(saved, b), false);
  const missingAge: Partial<typeof saved> = { ...saved }; delete missingAge.age;
  assert.equal(isHealthProfile(missingAge, a), false);
  assert.deepEqual(await new DemoStore(filename).getHealthProfile(a), saved);
  assert.equal(await getHealthProfile(context(store, "b")), null);
  const updated = await saveHealthProfile(context(store), { ...input, sex: null, age: null, height_cm: null, weight_kg: 55.2, expected_updated_at: saved.updated_at });
  assert.equal(updated.age, null);
  assert.equal(updated.weight_kg, 55.2);
  assert.equal(updated.created_at, saved.created_at);
  assert.notEqual(updated.updated_at, saved.updated_at);
  assert.equal(updated.consented_at, updated.updated_at);
  await saveHealthProfile(context(store, "b"), { ...input, age: 50 });
  await removeHealthProfile(context(store, "b"), { expected_updated_at: (await store.getHealthProfile(b))!.updated_at });
  assert.deepEqual(await store.getHealthProfile(a), updated);
  await removeHealthProfile(context(store), { expected_updated_at: updated.updated_at });
  assert.equal(await new DemoStore(filename).getHealthProfile(a), null);
  await removeHealthProfile(context(store), { expected_updated_at: updated.updated_at });
});

test("stale versions cannot overwrite, recreate or delete newer information", async t => {
  const { store } = await fixture(t); await store.agree(a);
  const saved = await store.saveHealthProfile(a, input);
  await assert.rejects(store.saveHealthProfile(a, input), code("STALE_PROFILE"));
  const updated = await store.saveHealthProfile(a, { ...input, age: 31, expected_updated_at: saved.updated_at });
  await assert.rejects(store.saveHealthProfile(a, { ...input, expected_updated_at: saved.updated_at }), code("STALE_PROFILE"));
  await assert.rejects(store.removeHealthProfile(a, saved.updated_at), code("STALE_PROFILE"));
  assert.equal((await store.getHealthProfile(a))!.age, 31);
  await store.removeHealthProfile(a, updated.updated_at);
  await assert.rejects(store.saveHealthProfile(a, { ...input, expected_updated_at: updated.updated_at }), code("STALE_PROFILE"));
  const recreated = await store.saveHealthProfile(a, input);
  await assert.rejects(store.removeHealthProfile(a, updated.updated_at), code("STALE_PROFILE"));
  assert.deepEqual(await store.getHealthProfile(a), recreated);
});

test("parallel first saves and edits have one winner across store instances", async t => {
  const { filename, store } = await fixture(t); await store.agree(a);
  const saves = await Promise.allSettled([store.saveHealthProfile(a, input), new DemoStore(filename).saveHealthProfile(a, { ...input, age: 40 })]);
  assert.equal(saves.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(saves.some(result => result.status === "rejected" && code("STALE_PROFILE")(result.reason)));
  const current = (await store.getHealthProfile(a))!;
  const edits = await Promise.allSettled([store.saveHealthProfile(a, { ...input, age: 41, expected_updated_at: current.updated_at }), new DemoStore(filename).saveHealthProfile(a, { ...input, age: 42, expected_updated_at: current.updated_at })]);
  assert.equal(edits.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(edits.some(result => result.status === "rejected" && code("STALE_PROFILE")(result.reason)));
});

test("deletion and recreation within one millisecond cannot reuse a profile version after restart", async t => {
  const { filename, store } = await fixture(t); await store.agree(a);
  t.mock.method(Date, "now", () => Date.parse("2026-10-23T12:00:00.000Z"));
  const saved = await store.saveHealthProfile(a, input);
  await store.removeHealthProfile(a, saved.updated_at);
  const recreated = await new DemoStore(filename).saveHealthProfile(a, input);
  assert.notEqual(recreated.updated_at, saved.updated_at);
  await assert.rejects(store.removeHealthProfile(a, saved.updated_at), code("STALE_PROFILE"));
});

test("version one migration preserves existing records, consent, preferences and extras", async t => {
  const { filename, store } = await fixture(t); await store.agree(a);
  await store.savePreferences(a, { matching_enabled: false, age_band: null, region: null, diagnosed: null, insulin_use: null, notice_version: "matching-v1" });
  const old = JSON.parse(await readFile(filename, "utf8"));
  old.version = 1; delete old.healthProfiles; old.futureProperty = { preserve: true };
  await writeFile(filename, JSON.stringify(old));
  assert.equal(validateDemoData(old), true);
  assert.equal(await new DemoStore(filename).getHealthProfile(a), null);
  assert.equal(JSON.parse(await readFile(filename, "utf8")).version, 1);
  await new DemoStore(filename).saveHealthProfile(a, input);
  const migrated = JSON.parse(await readFile(filename, "utf8"));
  assert.equal(migrated.version, 2);
  for (const key of ["records", "consents", "preferences", "futureProperty"]) assert.deepEqual(migrated[key], old[key]);
  assert.equal(migrated.healthProfiles.length, 1);
});

test("outdated app consent preserves own reads and deletion while preventing updates", async t => {
  const { filename, store } = await fixture(t); await store.agree(a);
  const saved = await store.saveHealthProfile(a, input);
  const data = JSON.parse(await readFile(filename, "utf8")); data.consents[0].policy_version = "old";
  await writeFile(filename, JSON.stringify(data));
  assert.deepEqual(await getHealthProfile(context(store, "a", "outdated")), saved);
  await assert.rejects(store.saveHealthProfile(a, { ...input, expected_updated_at: saved.updated_at }), code("CONSENT_REQUIRED"));
  await assert.rejects(saveHealthProfile(context(store, "a", "outdated"), input), code("CONSENT_REQUIRED"));
  await removeHealthProfile(context(store, "a", "outdated"), { expected_updated_at: saved.updated_at });
  assert.equal(await store.getHealthProfile(a), null);
});

test("corrupt profile storage fails closed and is left untouched for recovery", async t => {
  const { filename, store } = await fixture(t); await store.agree(a);
  const saved = await store.saveHealthProfile(a, input);
  const data = JSON.parse(await readFile(filename, "utf8"));
  for (const healthProfiles of [[saved, saved], [{ ...saved, user_id: "bad" }], [{ ...saved, age: 140 }], [{ ...saved, updated_at: "broken" }]]) {
    const text = JSON.stringify({ ...data, healthProfiles });
    await writeFile(filename, text);
    await assert.rejects(store.getHealthProfile(a), code("DATA_UNAVAILABLE"));
    assert.equal(await readFile(filename, "utf8"), text);
  }
});

test("profile mutations use same-origin gate and private response headers", async t => {
  const { store } = await fixture(t); await store.agree(a);
  const request = (origin: string) => new Request("http://localhost:3001/api/profile", { method: "PUT", headers: { host: "localhost:3001", origin } });
  const denied = await apiRoute(request("https://other.example"), () => saveHealthProfile(context(store), input), true);
  assert.equal(denied.status, 403);
  assert.equal(await store.getHealthProfile(a), null);
  const response = await apiRoute(request("http://localhost:3001"), () => saveHealthProfile(context(store), input), true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
});
