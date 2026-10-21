-- 회원과 비밀번호는 Supabase Auth가 관리해요. 여기서는 동의와 혈당 기록 표만 만들어요.
-- 이번 시연의 이용 안내 버전은 demo-v3로 고정해요.
begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.user_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  policy_version varchar(32) not null,
  agreed_at timestamptz not null default now()
);

create table public.glucose_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  glucose_mg_dl integer not null check (glucose_mg_dl > 0),
  measured_at timestamptz not null check (isfinite(measured_at)),
  measurement_context varchar(24) not null check (
    measurement_context in ('fasting', 'before_meal', 'after_meal_2h', 'other')
  ),
  meal_memo varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index glucose_records_user_measured_id_idx
  on public.glucose_records (user_id, measured_at desc, id desc);

comment on table public.user_consents is
  '계정당 최초 동의 한 건. 시연 안내 버전은 demo-v3이며 일반 사용자는 수정·삭제할 수 없습니다.';
comment on table public.glucose_records is
  '사용자가 직접 입력한 혈당 기록. 수치 제한은 저장 형식의 범위이며 건강 판정 기준이 아닙니다.';
comment on column public.glucose_records.id is
  '클라이언트가 첫 제출 전에 한 번 생성하는 UUID. 결과가 불명확하면 이 ID로 확인합니다.';
comment on column public.glucose_records.measured_at is
  '측정한 순간. 입력과 표시는 Asia/Seoul, 저장 자료형은 timestamptz입니다.';
comment on column public.glucose_records.meal_memo is
  '앞뒤 공백을 정리한 선택 메모. 비어 있으면 NULL, 최대 500 Unicode 코드포인트입니다.';

create function app_private.set_consent_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.agreed_at := pg_catalog.statement_timestamp();
  return new;
end;
$function$;

-- 직접 DB에 요청하더라도 기록 주인과 생성 시각을 바꾸지 못하게 한 번 더 검사해요.
create function app_private.prepare_glucose_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.created_at is distinct from old.created_at then
      raise exception 'record identity and creation time are immutable'
        using errcode = '23514';
    end if;
  else
    new.created_at := pg_catalog.statement_timestamp();
  end if;

  new.updated_at := pg_catalog.statement_timestamp();
  -- 화면의 trim과 같은 공백 문자를 지워, 화면과 DB에 저장되는 메모가 달라지지 않게 해요.
  new.meal_memo := nullif(pg_catalog.btrim(
    new.meal_memo,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  ), '');
  return new;
end;
$function$;

revoke all on function app_private.set_consent_timestamp() from public, anon, authenticated;
revoke all on function app_private.prepare_glucose_record() from public, anon, authenticated;

create trigger user_consents_timestamp_before_insert
before insert on public.user_consents
for each row execute function app_private.set_consent_timestamp();

create trigger glucose_records_prepare_before_write
before insert or update on public.glucose_records
for each row execute function app_private.prepare_glucose_record();

alter table public.user_consents enable row level security;
alter table public.glucose_records enable row level security;
alter table public.user_consents force row level security;
alter table public.glucose_records force row level security;

-- 기본 권한을 먼저 없앤 뒤, 아래에서 필요한 읽기·쓰기 권한만 다시 열어요.
revoke all on public.user_consents from public, anon, authenticated;
revoke all on public.glucose_records from public, anon, authenticated;

grant select on public.user_consents to authenticated;
grant insert (user_id, policy_version) on public.user_consents to authenticated;
grant select, delete on public.glucose_records to authenticated;
grant insert (
  id, user_id, glucose_mg_dl, measured_at, measurement_context, meal_memo
) on public.glucose_records to authenticated;
grant update (
  glucose_mg_dl, measured_at, measurement_context, meal_memo
) on public.glucose_records to authenticated;

-- 요청에 담긴 사용자 번호 대신 실제 로그인한 번호와 비교해서 본인 자료만 허용해요.
create policy consents_select_own
on public.user_consents for select
to authenticated
using ((select auth.uid()) = user_id);

create policy consents_insert_current_own
on public.user_consents for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and policy_version = 'demo-v3'
);

create policy records_select_own
on public.glucose_records for select
to authenticated
using ((select auth.uid()) = user_id);

create policy records_delete_own
on public.glucose_records for delete
to authenticated
using ((select auth.uid()) = user_id);

-- 새 저장과 수정에는 현재 안내문 동의가 필요해요. 기존 기록의 조회·삭제는 위 규칙을 따라요.
create policy records_insert_current_consent
on public.glucose_records for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.user_consents consent
    where consent.user_id = (select auth.uid())
      and consent.policy_version = 'demo-v3'
  )
);

create policy records_update_current_consent
on public.glucose_records for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.user_consents consent
    where consent.user_id = (select auth.uid())
      and consent.policy_version = 'demo-v3'
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.user_consents consent
    where consent.user_id = (select auth.uid())
      and consent.policy_version = 'demo-v3'
  )
);

commit;
