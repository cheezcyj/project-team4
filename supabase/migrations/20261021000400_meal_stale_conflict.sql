-- 예상한 버전 불일치는 일시적인 직렬화 실패가 아니므로 PostgREST가 재시도하지 않는 HTTP 409 코드로 응답해요.
-- 앞선 마이그레이션 이력은 보존하고 함수의 데이터 처리와 권한은 그대로 유지해요.
begin;

create or replace function public.save_meal_record(p_id uuid,p_meal jsonb,p_expected_updated_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $f$
declare
 caller uuid:=auth.uid();oldmeal public.meal_records;selectedfood public.food_catalog;item jsonb;prior jsonb;olditems jsonb:='[]';snapshot jsonb;itemid uuid;foodid uuid;amount numeric;unit text;freevalue text;v_memo text;conversion text;stamp timestamptz:=statement_timestamp();output jsonb;
begin
 if caller is null or not exists(select 1 from public.user_consents where user_id=caller and policy_version='demo-v3') then raise exception 'consent required' using errcode='42501';end if;
 if p_id is null or jsonb_typeof(p_meal) is distinct from 'object' or jsonb_typeof(p_meal->'items') is distinct from 'array' or jsonb_array_length(p_meal->'items')>100 or exists(select 1 from jsonb_object_keys(p_meal) k where k not in ('meal_at','meal_type','memo','items')) then raise exception 'invalid meal' using errcode='23514';end if;
 if jsonb_typeof(p_meal->'meal_at') is distinct from 'string' or jsonb_typeof(p_meal->'meal_type') is distinct from 'string' or (p_meal->'memo' is not null and jsonb_typeof(p_meal->'memo') not in ('string','null')) then raise exception 'invalid meal fields' using errcode='23514';end if;
 if (p_meal->>'meal_at')!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then raise exception 'ISO timestamp with timezone required' using errcode='23514';end if;
 v_memo:=nullif(btrim(p_meal->>'memo'),'');
 if jsonb_array_length(p_meal->'items')=0 and v_memo is null then raise exception 'empty meal' using errcode='23514';end if;
 select * into oldmeal from public.meal_records where id=p_id and user_id=caller for update;
 if p_expected_updated_at is not null then
  if oldmeal.id is null then raise exception 'not found' using errcode='P0002';end if;
  if oldmeal.updated_at is distinct from p_expected_updated_at then raise exception 'stale meal' using errcode='PT409';end if;
  select coalesce(jsonb_agg(to_jsonb(i)),'[]') into olditems from public.meal_items i where meal_id=p_id and user_id=caller;
  stamp:=greatest(stamp,oldmeal.updated_at+interval '1 microsecond');
  update public.meal_records set meal_at=(p_meal->>'meal_at')::timestamptz,meal_type=p_meal->>'meal_type',memo=v_memo,updated_at=stamp where id=p_id and user_id=caller;
 else
  insert into public.meal_records(id,user_id,meal_at,meal_type,memo,created_at,updated_at) values(p_id,caller,(p_meal->>'meal_at')::timestamptz,p_meal->>'meal_type',v_memo,stamp,stamp);
 end if;
 delete from public.meal_items where meal_id=p_id and user_id=caller;
 for item in select value from jsonb_array_elements(p_meal->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','food_id','free_text','amount_value','amount_unit')) then raise exception 'invalid meal item fields' using errcode='23514';end if;
  if (item->'free_text' is not null and jsonb_typeof(item->'free_text') not in ('string','null')) or (item->'amount_unit' is not null and jsonb_typeof(item->'amount_unit') not in ('string','null')) or (item->'amount_value' is not null and jsonb_typeof(item->'amount_value') not in ('number','null')) then raise exception 'invalid item value types' using errcode='23514';end if;
  itemid:=coalesce((item->>'id')::uuid,gen_random_uuid());foodid:=(item->>'food_id')::uuid;prior:=null;snapshot:=null;
  select value into prior from jsonb_array_elements(olditems) where value->>'id'=itemid::text;
  freevalue:=nullif(btrim(item->>'free_text'),'');unit:=nullif(btrim(item->>'amount_unit'),'');amount:=(item->>'amount_value')::numeric;
  if amount is not null and (amount<=0 or amount>=100000000 or round(amount,4)<>amount) then raise exception 'invalid amount' using errcode='23514';end if;
  if foodid is not null then
   if prior->>'food_id'=foodid::text then snapshot:=prior->'nutrition_snapshot';else
    select * into selectedfood from public.food_catalog where id=foodid and status='approved';
    if selectedfood.id is null then raise exception 'unapproved food' using errcode='23514';end if;
    snapshot:=jsonb_build_object('schema_version',1,'food_name',selectedfood.food_name,'source_code',selectedfood.source_code,'source',selectedfood.source,'source_version',selectedfood.source_version,'source_sha256',selectedfood.source_sha256,'basis_value',selectedfood.basis_value,'basis_unit',selectedfood.basis_unit,'nutrients',jsonb_build_object('kcal',selectedfood.kcal,'carbs_g',selectedfood.carbs_g,'sugars_g',selectedfood.sugars_g,'protein_g',selectedfood.protein_g,'fat_g',selectedfood.fat_g,'fiber_g',selectedfood.fiber_g,'sodium_mg',selectedfood.sodium_mg),'unit_validated',selectedfood.unit_validated,'captured_at',stamp);
   end if;
  end if;
  conversion:=case when amount is null then 'not_calculated' when snapshot is null or snapshot->>'unit_validated'<>'true' or unit is distinct from snapshot->>'basis_unit' then 'unavailable' when amount=(snapshot->>'basis_value')::numeric then 'same_basis' else 'verified' end;
  insert into public.meal_items(id,meal_id,user_id,food_id,free_text,amount_value,amount_unit,nutrition_snapshot,conversion_state,created_at,updated_at) values(itemid,p_id,caller,foodid,freevalue,amount,unit,snapshot,conversion,coalesce((prior->>'created_at')::timestamptz,stamp),stamp);
 end loop;
 select to_jsonb(m)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at,i.id) from public.meal_items i where i.meal_id=m.id and i.user_id=caller),'[]')) into output from public.meal_records m where m.id=p_id and m.user_id=caller;
 return output;
end;$f$;

commit;
