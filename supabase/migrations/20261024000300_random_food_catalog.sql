-- 기본 음식 목록은 전체 공개 후보에서 100개를 무작위로 선택합니다.
-- 호출자의 테이블 접근 권한과 행 접근 제어를 그대로 적용합니다.
create or replace function public.random_food_catalog()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  with eligible as materialized (
    select * from public.food_catalog
    where status = 'approved' and food_name !~ '^[[:space:]]*[?？]'
  ), sampled as (
    select * from eligible order by pg_catalog.random() limit 100
  )
  select pg_catalog.jsonb_build_object(
    'foods', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(sampled)), '[]'::jsonb) from sampled),
    'matched_count', (select count(*) from eligible),
    'truncated', (select count(*) > 100 from eligible),
    'limit', 100
  );
$$;

revoke all on function public.random_food_catalog() from public, anon;
grant execute on function public.random_food_catalog() to authenticated;
