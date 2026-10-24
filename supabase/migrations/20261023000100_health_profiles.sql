begin;

-- 선택 입력을 계정당 한 건만 보관해요. AI 요청에는 자동으로 전달하지 않아요.
create table public.health_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sex text check (sex in ('female', 'male', 'other')),
  age smallint check (age between 0 and 120),
  height_cm numeric check (height_cm between 30 and 250 and height_cm = round(height_cm, 1)),
  weight_kg numeric check (weight_kg between 1 and 500 and weight_kg = round(weight_kg, 1)),
  notice_version text not null check (notice_version = 'health-profile-v1'),
  consented_at timestamptz not null check (isfinite(consented_at)),
  created_at timestamptz not null check (isfinite(created_at)),
  updated_at timestamptz not null check (isfinite(updated_at)),
  constraint health_profile_not_empty check (
    sex is not null or age is not null or height_cm is not null or weight_kg is not null
  )
);

comment on table public.health_profiles is
  '회원이 별도 저장 안내에 동의한 성별·나이·키·몸무게. 모든 항목은 선택이며 본인만 조회·수정·삭제합니다.';
comment on column public.health_profiles.age is
  '입력 시점의 나이. 생년월일을 수집하거나 나이를 자동 증가시키지 않습니다.';

alter table public.health_profiles enable row level security;
alter table public.health_profiles force row level security;
revoke all on public.health_profiles from public, anon, authenticated;
grant select on public.health_profiles to authenticated;
create policy health_profiles_select_own on public.health_profiles for select
  to authenticated using ((select auth.uid()) = user_id);

create function public.save_health_profile(p_profile jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  caller uuid := auth.uid();
  previous public.health_profiles%rowtype;
  saved public.health_profiles%rowtype;
  input_age numeric;
  input_height numeric;
  input_weight numeric;
  write_time timestamptz;
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception 'profile must be an object' using errcode = '23514';
  end if;
  if p_profile->'allow_storage' is distinct from 'true'::jsonb
    or p_profile->>'notice_version' is distinct from 'health-profile-v1'
    or exists (select 1 from jsonb_object_keys(p_profile) k where k not in (
      'sex', 'age', 'height_cm', 'weight_kg', 'allow_storage', 'notice_version'
    ))
    or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at)) then
    raise exception 'invalid profile or storage consent' using errcode = '23514';
  end if;
  if coalesce(jsonb_typeof(p_profile->'sex'), 'null') not in ('string', 'null')
    or (p_profile->>'sex' is not null and p_profile->>'sex' not in ('female', 'male', 'other'))
    or coalesce(jsonb_typeof(p_profile->'age'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_profile->'height_cm'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_profile->'weight_kg'), 'null') not in ('number', 'null') then
    raise exception 'invalid profile field type' using errcode = '23514';
  end if;
  input_age := (p_profile->>'age')::numeric;
  input_height := (p_profile->>'height_cm')::numeric;
  input_weight := (p_profile->>'weight_kg')::numeric;
  if (input_age is not null and (input_age not between 0 and 120 or input_age <> trunc(input_age)))
    or (input_height is not null and (input_height not between 30 and 250 or input_height <> round(input_height, 1)))
    or (input_weight is not null and (input_weight not between 1 and 500 or input_weight <> round(input_weight, 1)))
    or (p_profile->>'sex' is null and input_age is null and input_height is null and input_weight is null) then
    raise exception 'profile values outside storage limits or empty' using errcode = '23514';
  end if;

  -- 아직 프로필이 없어도 계정 행을 잠그면 두 화면의 최초 저장이 동시에 덮어쓰지 않아요.
  perform 1 from auth.users where id = caller for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_consents where user_id = caller and policy_version = 'demo-v3') then
    raise exception 'current application consent required' using errcode = '42501';
  end if;
  select * into previous from public.health_profiles where user_id = caller for update;
  if found then
    if p_expected_updated_at is distinct from previous.updated_at then
      raise exception 'stale health profile' using errcode = 'PT409';
    end if;
  elsif p_expected_updated_at is not null then
    raise exception 'health profile was removed' using errcode = 'PT409';
  end if;
  write_time := greatest(clock_timestamp(), coalesce(previous.updated_at + interval '1 microsecond', '-infinity'::timestamptz));
  insert into public.health_profiles (
    user_id, sex, age, height_cm, weight_kg, notice_version, consented_at, created_at, updated_at
  ) values (
    caller, p_profile->>'sex', input_age::smallint, input_height, input_weight,
    'health-profile-v1', write_time, coalesce(previous.created_at, write_time), write_time
  ) on conflict (user_id) do update set
    sex = excluded.sex, age = excluded.age, height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg, notice_version = excluded.notice_version,
    consented_at = excluded.consented_at, updated_at = excluded.updated_at
  returning * into saved;
  return to_jsonb(saved);
end;
$function$;

create function public.delete_health_profile(p_expected_updated_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  caller uuid := auth.uid();
  previous public.health_profiles%rowtype;
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_expected_updated_at is null or not isfinite(p_expected_updated_at) then
    raise exception 'profile version required' using errcode = '23514';
  end if;
  perform 1 from auth.users where id = caller for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  select * into previous from public.health_profiles where user_id = caller for update;
  if not found then return; end if;
  if p_expected_updated_at is distinct from previous.updated_at then
    raise exception 'stale health profile' using errcode = 'PT409';
  end if;
  delete from public.health_profiles where user_id = caller;
end;
$function$;

revoke all on function public.save_health_profile(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_health_profile(timestamptz) from public, anon, authenticated;
grant execute on function public.save_health_profile(jsonb, timestamptz) to authenticated;
grant execute on function public.delete_health_profile(timestamptz) to authenticated;

commit;
