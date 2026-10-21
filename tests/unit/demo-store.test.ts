import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dayRange, seoulDay, type RecordInput } from "../../src/lib/domain";
import { DemoStore, DEMO_USERS } from "../../src/lib/server/demo-store";
import { ApiError } from "../../src/lib/server/errors";

const a = DEMO_USERS.a.id;
const b = DEMO_USERS.b.id;
const input: RecordInput = {
  glucose_mg_dl: 110,
  measured_at: new Date().toISOString(),
  measurement_context: "fasting",
  meal_memo: null,
};
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "glucose-demo-test-"));
  const filename = path.join(directory, "data.json");
  return { directory, filename, store: new DemoStore(filename) };
}

test("missing consent allows own read/delete, denies writes, and never exposes another account", async () => {
  const { directory, store } = await fixture();
  try {
    assert.equal(await store.consent(a), "missing");
    const own = await store.get(a, "10000000-0000-4000-8000-000000000001");
    assert.equal(own.user_id, a);
    await assert.rejects(store.get(b, own.id), code("NOT_FOUND"));
    await assert.rejects(store.remove(b, own.id), code("NOT_FOUND"));
    await assert.rejects(store.insert(a, randomUUID(), input), code("CONSENT_REQUIRED"));
    await assert.rejects(store.update(a, own.id, input, own.updated_at), code("CONSENT_REQUIRED"));
    await store.remove(a, own.id);
    await assert.rejects(store.get(a, own.id), code("NOT_FOUND"));
    assert.equal(await store.consent(b), "missing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writes survive a new store instance, duplicate UUID is not retried, stale updates conflict", async () => {
  const { directory, filename, store } = await fixture();
  try {
    await store.agree(a);
    const id = randomUUID();
    const saved = await store.insert(a, id, input);
    assert.equal((await new DemoStore(filename).get(a, id)).glucose_mg_dl, 110);
    await assert.rejects(store.insert(a, id, input), code("RECORD_EXISTS"));
    const updated = await store.update(a, id, { ...input, glucose_mg_dl: 125 }, saved.updated_at);
    assert.equal(updated.glucose_mg_dl, 125);
    assert.equal(updated.id, saved.id);
    assert.equal(updated.user_id, saved.user_id);
    assert.equal(updated.created_at, saved.created_at);
    assert.notEqual(updated.updated_at, saved.updated_at);
    await assert.rejects(store.update(a, id, input, saved.updated_at), code("STALE_RECORD"));
    await assert.rejects(store.get(b, id), code("NOT_FOUND"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parallel writes from different store instances are serialized without losing records", async () => {
  const { directory, filename, store } = await fixture();
  try {
    await store.agree(a);
    const ids: string[] = Array.from({ length: 25 }, () => randomUUID());
    await Promise.all(ids.map((id) => new DemoStore(filename).insert(a, id, input)));
    const rows = await store.list(a, dayRange(seoulDay(input.measured_at)));
    assert.equal(rows.filter((row) => ids.includes(row.id)).length, 25);
    const stored = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(stored.records.length, 29);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("old consent is preserved, blocks editing, and retains own read/delete", async () => {
  const { directory, filename, store } = await fixture();
  try {
    await store.agree(a);
    const stored = JSON.parse(await readFile(filename, "utf8"));
    stored.consents[0].policy_version = "older-policy";
    await writeFile(filename, JSON.stringify(stored));
    assert.equal(await store.consent(a), "outdated");
    await assert.rejects(store.agree(a), code("POLICY_OUTDATED"));
    await assert.rejects(store.insert(a, randomUUID(), input), code("CONSENT_REQUIRED"));
    const own = await store.get(a, "10000000-0000-4000-8000-000000000001");
    await store.remove(a, own.id);
    assert.equal(await store.consent(a), "outdated");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid existing storage fails closed and is preserved for recovery", async () => {
  const { directory, filename, store } = await fixture();
  try {
    const invalid = '{"version":1,"records":[{"id":"broken"}],"consents":[]}';
    await writeFile(filename, invalid);
    await assert.rejects(store.list(a, dayRange(seoulDay())), code("DATA_UNAVAILABLE"));
    assert.equal(await readFile(filename, "utf8"), invalid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
