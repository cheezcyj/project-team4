import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// This process creates a disposable in-memory PostgreSQL instance. It never
// reads a connection URL or contacts a Supabase project.
const db = new PGlite();
try {
  const [{ version }] = (await db.query("select version()")).rows;
  console.log(`Database SQL tests: ${version}`);
  console.log("Environment: isolated PGlite; Auth identities are SQL fixtures.");
  // Supabase owns these objects in a real project. Only this in-memory test
  // fixture supplies the minimal equivalent needed to exercise the app SQL.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid
      language sql stable security invoker set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    select set_config('app.db_test_allowed', 'isolated-fake-data-only', false);
  `);
  const migration = await readFile(
    new URL("../migrations/20261020000100_glucose_records.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  const assertions = await readFile(new URL("./assertions.sql", import.meta.url), "utf8");
  const results = await db.exec(assertions);
  const passed = results.flatMap((result) =>
    result.rows.flatMap((row) =>
      Object.values(row).filter((value) => typeof value === "string" && value.startsWith("ok - ")),
    ),
  );
  for (const result of passed) console.log(result);
  if (passed.length < 60) {
    throw new Error(`Expected at least 60 SQL assertions, received ${passed.length}.`);
  }
  const remaining = await db.query(
    "select (select count(*) from auth.users) + (select count(*) from public.user_consents) + (select count(*) from public.glucose_records) as remaining",
  );
  if (Number(remaining.rows[0].remaining) !== 0) {
    throw new Error("Test transaction did not roll back its fixtures.");
  }
  console.log(`PASS: ${passed.length} SQL assertions; all test fixtures rolled back.`);
  console.log("Not covered: hosted Supabase Auth, JWT validation, PostgREST, HTTP pagination or cloud deployment.");
} finally {
  await db.close();
}
await import('./non-ai-features.mjs');
