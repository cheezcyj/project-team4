-- Run only in an isolated, disposable database after the app migration.
-- Every fixture and helper is rolled back. Never run against customer data.
begin;

do $guard$
begin
  if current_setting('app.db_test_allowed', true) is distinct from 'isolated-fake-data-only' then
    raise exception 'Set app.db_test_allowed only for an isolated fake-data database';
  end if;
end;
$guard$;

create function pg_temp.assert_true(actual boolean, label text)
returns text language plpgsql security invoker as $function$
begin
  if actual is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  return 'ok - ' || label;
end;
$function$;

create function pg_temp.expect_error(statement text, expected_state text, label text)
returns text language plpgsql security invoker as $function$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then
      return 'ok - ' || label;
    end if;
    raise exception 'FAIL: %, expected SQLSTATE %, got %', label, expected_state, sqlstate;
  end;
  raise exception 'FAIL: %, expected an error but statement succeeded', label;
end;
$function$;

create function pg_temp.assert_affected(statement text, expected_count bigint, label text)
returns text language plpgsql security invoker as $function$
declare
  actual_count bigint;
begin
  execute statement;
  get diagnostics actual_count = row_count;
  if actual_count <> expected_count then
    raise exception 'FAIL: %, expected % affected rows, got %', label, expected_count, actual_count;
  end if;
  return 'ok - ' || label;
end;
$function$;

-- These IDs and example.invalid addresses are disposable test fixtures.
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'rls-a@example.invalid'),
  ('b0000000-0000-4000-8000-000000000002', 'rls-b@example.invalid'),
  ('c0000000-0000-4000-8000-000000000003', 'rls-no-consent@example.invalid'),
  ('d0000000-0000-4000-8000-000000000004', 'rls-old-consent@example.invalid');

insert into public.user_consents (user_id, policy_version) values
  ('d0000000-0000-4000-8000-000000000004', 'old-demo-policy');
insert into public.glucose_records
  (id, user_id, glucose_mg_dl, measured_at, measurement_context) values
  ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 101, '2026-10-20T00:00:00Z', 'fasting'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 102, '2026-10-20T00:00:00Z', 'other');

select pg_temp.assert_true(
  (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('user_consents', 'glucose_records')
      and c.relrowsecurity and c.relforcerowsecurity), 'both app tables enforce RLS');
select pg_temp.assert_true(
  (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private' and p.proname in ('set_consent_timestamp', 'prepare_glucose_record')
      and not p.prosecdef and p.proconfig @> array['search_path=""']), 'trigger helpers are invokers with empty search_path');
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.user_consents', 'UPDATE,DELETE'),
  'consent update and delete have no grants');
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.glucose_records', 'created_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.glucose_records', 'updated_at', 'UPDATE'),
  'generated timestamp columns have no client write grants');

set local role anon;
select pg_temp.expect_error('select * from public.user_consents', '42501', 'anonymous consent read denied');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version) values ('a0000000-0000-4000-8000-000000000001','demo-v3')$q$, '42501', 'anonymous consent insert denied');
select pg_temp.expect_error($q$update public.user_consents set policy_version='demo-v3'$q$, '42501', 'anonymous consent update denied');
select pg_temp.expect_error('delete from public.user_consents', '42501', 'anonymous consent delete denied');
select pg_temp.expect_error('select * from public.glucose_records', '42501', 'anonymous record read denied');
select pg_temp.expect_error($q$insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',100,now(),'fasting')$q$, '42501', 'anonymous record insert denied');
select pg_temp.expect_error('update public.glucose_records set glucose_mg_dl=99', '42501', 'anonymous record update denied');
select pg_temp.expect_error('delete from public.glucose_records', '42501', 'anonymous record delete denied');

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.assert_true((select count(*) = 0 from public.glucose_records), 'authenticated role without user identity reads nothing');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version) values ('a0000000-0000-4000-8000-000000000001','demo-v3')$q$, '42501', 'missing user identity cannot consent');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true((select count(*) = 0 from public.user_consents), 'A cannot read old-policy consent belonging to D');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version) values ('b0000000-0000-4000-8000-000000000002','demo-v3')$q$, '42501', 'A cannot insert B consent');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version) values ('a0000000-0000-4000-8000-000000000001','old-demo-policy')$q$, '42501', 'client cannot consent to a different policy version');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version,agreed_at) values ('a0000000-0000-4000-8000-000000000001','demo-v3','2000-01-01')$q$, '42501', 'client cannot supply agreed_at');
select pg_temp.expect_error($q$insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',100,now(),'fasting')$q$, '42501', 'A cannot create a record before consent');
insert into public.user_consents(user_id, policy_version) values
  ('a0000000-0000-4000-8000-000000000001', 'demo-v3');
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(agreed_at >= transaction_timestamp()) from public.user_consents),
  'A reads its own first consent with server timestamp');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version) values ('a0000000-0000-4000-8000-000000000001','demo-v3')$q$, '23505', 'repeat consent insert cannot overwrite first agreement');
select pg_temp.expect_error($q$update public.user_consents set policy_version='old-demo-policy'$q$, '42501', 'user cannot alter consent');
select pg_temp.expect_error('delete from public.user_consents', '42501', 'user cannot delete consent');

insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context,meal_memo) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 100, '2026-10-20T00:00:00Z', 'fasting', E'\t 아침 \n'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 130, '2026-10-20T00:00:00Z', 'after_meal_2h', U&'\00A0\3000\FEFF');
select pg_temp.assert_true(
  (select count(*) = 2 from public.glucose_records), 'A sees two own records and none from C or D');
select pg_temp.assert_true(
  (select meal_memo = '아침' and created_at >= transaction_timestamp() and updated_at = created_at
    from public.glucose_records where id = 'a1000000-0000-4000-8000-000000000001'),
  'insert trims memo and generates both timestamps');
select pg_temp.assert_true(
  (select meal_memo is null from public.glucose_records where id = 'a1000000-0000-4000-8000-000000000002'),
  'Unicode whitespace-only memo is NULL');
select pg_temp.assert_true(
  (select count(distinct measured_at) = 1 from public.glucose_records), 'equal measured times remain separate records');
select pg_temp.expect_error($q$insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values ('a1000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002',100,now(),'fasting')$q$, '42501', 'A cannot insert a record for B');
select pg_temp.expect_error($q$insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context,created_at) values ('a1000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001',100,now(),'fasting','2000-01-01')$q$, '42501', 'client cannot forge record creation time');
select pg_temp.expect_error($q$update public.glucose_records set id='a1000000-0000-4000-8000-000000000009'$q$, '42501', 'client cannot change record ID');
select pg_temp.expect_error($q$update public.glucose_records set user_id='b0000000-0000-4000-8000-000000000002'$q$, '42501', 'client cannot change record owner');
select pg_temp.expect_error($q$update public.glucose_records set created_at='2000-01-01'$q$, '42501', 'client cannot change creation time');
select pg_temp.expect_error($q$update public.glucose_records set updated_at='2000-01-01'$q$, '42501', 'client cannot forge update time');
select pg_temp.expect_error($q$update public.glucose_records set glucose_mg_dl=0$q$, '23514', 'zero glucose rejected');
select pg_temp.expect_error($q$update public.glucose_records set glucose_mg_dl=-1$q$, '23514', 'negative glucose rejected');
select pg_temp.expect_error($q$update public.glucose_records set glucose_mg_dl='1.5'$q$, '22P02', 'fractional integer text rejected');
select pg_temp.expect_error($q$update public.glucose_records set glucose_mg_dl=2147483648$q$, '22003', 'integer overflow rejected');
select pg_temp.expect_error($q$update public.glucose_records set glucose_mg_dl=null$q$, '23502', 'missing glucose rejected');
select pg_temp.expect_error($q$update public.glucose_records set measurement_context='unknown'$q$, '23514', 'unknown measurement context rejected');
select pg_temp.expect_error($q$update public.glucose_records set measured_at='infinity'$q$, '23514', 'infinite timestamp rejected');
select pg_temp.expect_error($q$update public.glucose_records set meal_memo=repeat('한',501)$q$, '22001', '501 Korean codepoints rejected');
select pg_temp.expect_error($q$update public.glucose_records set meal_memo=repeat('😀',501)$q$, '22001', '501 emoji codepoints rejected');
select pg_temp.assert_affected(
  $q$update public.glucose_records set glucose_mg_dl=2147483647, meal_memo=repeat('😀',500)
    where id='a1000000-0000-4000-8000-000000000001'$q$, 1, 'integer max and 500 emoji codepoints accepted');
select pg_temp.assert_true(
  (select char_length(meal_memo)=500 and updated_at >= created_at
    from public.glucose_records where id='a1000000-0000-4000-8000-000000000001'),
  '500 codepoints preserved with server update timestamp');
select pg_temp.assert_affected(
  $q$update public.glucose_records set glucose_mg_dl=1, meal_memo=''
    where id='a1000000-0000-4000-8000-000000000001'$q$, 1, 'minimum positive integer accepted');
select pg_temp.assert_true(
  (select meal_memo is null from public.glucose_records where id='a1000000-0000-4000-8000-000000000001'),
  'empty memo is normalized on update');

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
insert into public.user_consents(user_id,policy_version) values ('b0000000-0000-4000-8000-000000000002','demo-v3');
select pg_temp.assert_true((select count(*)=0 from public.glucose_records), 'B cannot read A records by direct table query');
select pg_temp.assert_true(
  (select count(*)=0 from public.glucose_records where id='a1000000-0000-4000-8000-000000000001'),
  'B cannot read A record by known ID');
select pg_temp.assert_affected('update public.glucose_records set glucose_mg_dl=999', 0, 'B cannot update any foreign record');
select pg_temp.assert_affected('delete from public.glucose_records', 0, 'B cannot delete any foreign record');
insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',120,'2026-10-20T01:00:00Z','before_meal');
select pg_temp.assert_true((select count(*)=1 from public.glucose_records), 'B can create and read its own record');
select pg_temp.assert_affected('update public.glucose_records set glucose_mg_dl=121', 1, 'B can update its own record');
select pg_temp.assert_affected('delete from public.glucose_records', 1, 'B can delete its own record');

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_true((select count(*)=1 from public.glucose_records), 'no-consent user can read existing own record');
select pg_temp.assert_affected('update public.glucose_records set glucose_mg_dl=900', 0, 'no-consent user cannot update existing record');
select pg_temp.expect_error($q$insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values ('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003',100,now(),'fasting')$q$, '42501', 'no-consent user cannot insert record');
select pg_temp.assert_affected('delete from public.glucose_records', 1, 'no-consent user can delete own record');

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000004', true);
select pg_temp.assert_true(
  (select policy_version='old-demo-policy' from public.user_consents), 'old-policy user can read own consent status');
select pg_temp.assert_true((select count(*)=1 from public.glucose_records), 'old-policy user can read existing own record');
select pg_temp.assert_affected('update public.glucose_records set glucose_mg_dl=901', 0, 'old-policy user cannot update existing record');
select pg_temp.expect_error($q$insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context) values ('d1000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000004',100,now(),'fasting')$q$, '42501', 'old-policy user cannot insert record');
select pg_temp.expect_error($q$insert into public.user_consents(user_id,policy_version) values ('d0000000-0000-4000-8000-000000000004','demo-v3')$q$, '23505', 'old consent cannot be silently replaced with a new row');
select pg_temp.assert_affected('delete from public.glucose_records', 1, 'old-policy user can delete own record');

reset role;
select pg_temp.expect_error(
  $q$update public.glucose_records set id='a1000000-0000-4000-8000-000000000009'
    where id='a1000000-0000-4000-8000-000000000001'$q$, '23514', 'trigger also preserves ID for privileged updates');
select pg_temp.expect_error(
  $q$update public.glucose_records set user_id='b0000000-0000-4000-8000-000000000002'
    where id='a1000000-0000-4000-8000-000000000001'$q$, '23514', 'trigger also preserves owner for privileged updates');
select pg_temp.expect_error(
  $q$update public.glucose_records set created_at='2000-01-01'
    where id='a1000000-0000-4000-8000-000000000001'$q$, '23514', 'trigger also preserves creation time for privileged updates');
update public.glucose_records set updated_at='2000-01-01'
where id='a1000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  (select updated_at >= transaction_timestamp() from public.glucose_records where id='a1000000-0000-4000-8000-000000000001'),
  'trigger overwrites privileged update timestamp with database time');
select pg_temp.assert_true(
  (select count(*)=2 from public.glucose_records where user_id='a0000000-0000-4000-8000-000000000001'),
  'foreign-account mutations left both A records intact');
delete from auth.users where id='a0000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  not exists(select 1 from public.user_consents where user_id='a0000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.glucose_records where user_id='a0000000-0000-4000-8000-000000000001'),
  'administrative test account deletion cascades to both app tables');
select pg_temp.assert_true(
  exists(select 1 from public.user_consents where user_id='b0000000-0000-4000-8000-000000000002'),
  'deleting A account preserves B consent');

rollback;
