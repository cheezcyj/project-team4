import assert from "node:assert/strict";
import test from "node:test";
import { isProjectAuthCookie, signupFields } from "../../src/lib/account-validation";

const valid = { email: "member@example.invalid", password: "a-long-test-password", passwordConfirmation: "a-long-test-password" };
test("signup requires valid email, a long matching password and limits bcrypt input to 72 bytes", () => {
  assert.deepEqual(signupFields(valid), {});
  assert.ok(signupFields({ ...valid, email: "broken" }).email);
  assert.ok(signupFields({ ...valid, password: "short" }).password);
  assert.ok(signupFields({ ...valid, passwordConfirmation: "different" }).passwordConfirmation);
  assert.deepEqual(signupFields({ ...valid, password: "a".repeat(72), passwordConfirmation: "a".repeat(72) }), {});
  assert.ok(signupFields({ ...valid, password: "a".repeat(73) }).password);
  assert.ok(signupFields({ ...valid, password: "가".repeat(25) }).password);
  assert.ok(signupFields({ ...valid, password: "contains-null\0-character" }).password);
  assert.ok(signupFields({ email: [], password: {}, passwordConfirmation: {} }).email);
});

test("withdrawal clears chunked authentication and every PKCE flow cookie for this project only", () => {
  const url = "https://project.supabase.co";
  for (const suffix of ["", ".0", ".1", "-code-verifier", "-flows-code-verifier", "-flow-unique-id-code-verifier"]) {
    assert.equal(isProjectAuthCookie(`sb-project-auth-token${suffix}`, url), true);
  }
  for (const name of ["sb-other-auth-token", "sb-project-auth-token-other-project.0x".replace("project", "projectx"), "unrelated-cookie"]) {
    assert.equal(isProjectAuthCookie(name, url), false);
  }
});
