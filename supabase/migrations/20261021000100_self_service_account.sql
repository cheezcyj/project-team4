-- 앱에 관리자 키를 주지 않고, 최근 2분 안에 비밀번호로 다시 로그인한 본인만 탈퇴시켜요.
-- 삭제할 사용자 번호를 입력받지 않고, 확인된 로그인 정보에서 직접 가져와요.
begin;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller uuid := auth.uid();
  claims jsonb := auth.jwt();
begin
  if caller is null or coalesce(claims->>'role', '') <> 'authenticated' then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- 인증 토큰을 갱신한 것만으로는 부족해요. 새 로그인 세션과 비밀번호 인증을 모두 확인해요.
  if not exists (
    select 1 from auth.sessions s
    where s.id::text = claims->>'session_id' and s.user_id = caller
      and s.created_at >= pg_catalog.statement_timestamp() - interval '2 minutes'
  ) or not exists (
    select 1 from pg_catalog.jsonb_array_elements(coalesce(claims->'amr', '[]'::jsonb)) amr
    where amr->>'method' = 'password'
      and (amr->>'timestamp')::numeric >= extract(epoch from pg_catalog.statement_timestamp() - interval '2 minutes')
  ) then
    raise exception 'recent password sign-in required' using errcode = '42501';
  end if;
  -- 회원 삭제에 연결된 기록·동의·로그인 세션도 함께 지워져요.
  -- 중간에 실패하면 전체 삭제가 취소되어 일부 자료만 사라지는 일을 막아요.
  delete from auth.users where id = caller;
  if not found then
    raise exception 'account unavailable' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
comment on function public.delete_my_account() is '본인의 최근 비밀번호 인증 세션으로만 본인 계정과 연결 기록을 삭제합니다.';
commit;
