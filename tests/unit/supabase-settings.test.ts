import test from "node:test";
import assert from "node:assert/strict";
import { readSupabaseSettings } from "../../src/lib/server/supabase-settings";

const publicKey = "sb_publishable_test-only-not-a-real-key";
const legacy = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

test("Supabase settings prefer runtime server variables and retain legacy anon compatibility", () => {
  assert.equal(readSupabaseSettings({ SUPABASE_URL: "https://runtime.example.invalid", SUPABASE_PUBLISHABLE_KEY: publicKey, NEXT_PUBLIC_SUPABASE_URL: "https://built.example.invalid" })?.url, "https://runtime.example.invalid");
  assert.equal(readSupabaseSettings({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: legacy("anon") })?.publishableKey, legacy("anon"));
  assert.equal(readSupabaseSettings({}), null);
});

test("Supabase settings reject privileged keys and insecure remote endpoints", () => {
  for (const key of ["sb_secret_test-only", legacy("service_role"), legacy("authenticated"), "invalid"]) {
    assert.equal(readSupabaseSettings({ SUPABASE_URL: "https://example.invalid", SUPABASE_PUBLISHABLE_KEY: key }), null);
  }
  for (const url of ["http://example.invalid", "https://name:password@example.invalid", "not-a-url"]) {
    assert.equal(readSupabaseSettings({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publicKey }), null);
  }
});
