begin;

alter table public.glucose_records drop constraint glucose_records_measurement_context_check;
alter table public.glucose_records add constraint glucose_records_measurement_context_check check (measurement_context in ('fasting','before_meal','after_meal','after_meal_2h','on_waking','before_sleep','nighttime','before_exercise','after_exercise','other'));
alter table public.glucose_records add column meal_slot varchar(16), add column import_batch_id uuid, add column source_row_number integer;
alter table public.glucose_records add constraint glucose_meal_slot_check check (meal_slot is null or (meal_slot in ('breakfast','lunch','dinner','snack') and measurement_context in ('before_meal','after_meal','after_meal_2h')));
alter table public.glucose_records add constraint glucose_import_pair_check check ((import_batch_id is null and source_row_number is null) or (import_batch_id is not null and source_row_number between 1 and 1000));
grant insert (meal_slot), update (meal_slot) on public.glucose_records to authenticated;

create table public.import_batches (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, file_sha256 char(64) not null check(file_sha256 ~ '^[0-9a-f]{64}$'), content_sha256 char(64) not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 row_count integer not null check(row_count between 1 and 1000), imported_at timestamptz not null default statement_timestamp(), format_version varchar(32) not null,
 unique(id,user_id),unique(user_id,request_id),unique(user_id,file_sha256),unique(user_id,content_sha256)
);
alter table public.glucose_records add foreign key (import_batch_id,user_id) references public.import_batches(id,user_id), add unique(import_batch_id,source_row_number);
create index import_batches_user_time_idx on public.import_batches(user_id,imported_at desc);
-- 내용이 같은 별도 요청도 원래 결과를 다시 찾을 수 있도록 요청별 영수증만 남겨요.
create table public.import_requests (
 user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,batch_id uuid not null,
 file_sha256 char(64) not null check(file_sha256 ~ '^[0-9a-f]{64}$'),content_sha256 char(64) not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 primary key(user_id,request_id),foreign key(batch_id,user_id) references public.import_batches(id,user_id) on delete cascade
);

create table public.food_catalog (
 id uuid primary key, food_name varchar(200) not null, source_code varchar(100) not null,
 basis_value numeric(12,4) not null check(basis_value>0), basis_unit varchar(40) not null check(length(btrim(basis_unit))>0),
 kcal numeric(12,4) check(kcal>=0), carbs_g numeric(12,4) check(carbs_g>=0), sugars_g numeric(12,4) check(sugars_g>=0), protein_g numeric(12,4) check(protein_g>=0), fat_g numeric(12,4) check(fat_g>=0), fiber_g numeric(12,4) check(fiber_g>=0), sodium_mg numeric(12,4) check(sodium_mg>=0),
 source varchar(200) not null,source_url text,source_version varchar(80) not null,source_sha256 char(64) not null check(source_sha256 ~ '^[0-9a-f]{64}$'),source_type varchar(32) not null,source_weight varchar(80),unit_validated boolean not null default false,
 status varchar(16) not null check(status in ('review','approved','blocked')),checked_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(source,source_version,source_code)
);
create index food_catalog_name_idx on public.food_catalog(status,food_name);
create table public.meal_records (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 meal_at timestamptz not null check(isfinite(meal_at)),meal_type varchar(16) not null check(meal_type in ('breakfast','lunch','dinner','snack','other')),
 memo varchar(500),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id)
);
create index meal_records_user_time_idx on public.meal_records(user_id,meal_at desc,id desc);
create table public.meal_items (
 id uuid primary key,meal_id uuid not null,user_id uuid not null,
 food_id uuid references public.food_catalog(id) on delete restrict,free_text varchar(200),amount_value numeric(12,4) check(amount_value>0),amount_unit varchar(40),nutrition_snapshot jsonb,
 conversion_state varchar(20) not null default 'not_calculated' check(conversion_state in ('not_calculated','same_basis','verified','unavailable')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(meal_id,user_id) references public.meal_records(id,user_id) on delete cascade,
 check(food_id is not null or nullif(btrim(free_text),'') is not null),check(food_id is null or nutrition_snapshot is not null),
 check((amount_value is null and amount_unit is null) or (amount_value is not null and nullif(btrim(amount_unit),'') is not null))
);
create index meal_items_parent_idx on public.meal_items(meal_id,user_id);
create table public.user_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,region varchar(80),age_band varchar(16) check(age_band in ('under_19','19_39','40_64','65_plus')),diagnosed boolean,insulin_use boolean,
 matching_enabled boolean not null default false,notice_version varchar(32) not null check(notice_version='matching-v1'),consented_at timestamptz,updated_at timestamptz not null default now(),check(not matching_enabled or consented_at is not null)
);
create table public.benefit_rules (
 id uuid primary key,name varchar(200) not null,agency varchar(200) not null,region_scope jsonb not null check(jsonb_typeof(region_scope)='array'),criteria_json jsonb not null check(jsonb_typeof(criteria_json)='object' and criteria_json->>'schema_version'='1'),description text not null,source_url text not null,source_key varchar(100) not null,version integer not null check(version>0),
 valid_from date,valid_until date,checked_at timestamptz not null,review_due_at timestamptz not null,status varchar(16) not null check(status in ('review','approved','retired')),created_at timestamptz not null default now(),unique(source_key,version),check(valid_until is null or valid_from is null or valid_until>=valid_from)
);
create table public.health_articles (
 id uuid primary key,title varchar(300) not null,source varchar(200) not null,published_at timestamptz,url text not null unique,fetched_at timestamptz not null default now(),keywords text[] not null default '{}',checked_at timestamptz not null,status varchar(16) not null check(status in ('review','approved','blocked')),source_channel varchar(16) not null check(source_channel in ('rss','api','public_page'))
);
create index health_articles_status_time_idx on public.health_articles(status,published_at desc);

create or replace function app_private.prepare_glucose_record() returns trigger language plpgsql security invoker set search_path='' as $f$
begin
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at or new.import_batch_id is distinct from old.import_batch_id or new.source_row_number is distinct from old.source_row_number then raise exception 'immutable record fields' using errcode='23514'; end if;
  new.updated_at:=greatest(statement_timestamp(),old.updated_at+interval '1 microsecond');
 else new.created_at:=statement_timestamp();new.updated_at:=statement_timestamp();end if;
 new.meal_memo:=nullif(btrim(new.meal_memo,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'');return new;
end;$f$;
create function app_private.prepare_preferences() returns trigger language plpgsql security invoker set search_path='' as $f$
begin
 if tg_op='UPDATE' and new.user_id is distinct from old.user_id then raise exception 'immutable owner' using errcode='23514';end if;
 new.updated_at:=statement_timestamp();new.region:=nullif(btrim(new.region),'');
 if new.matching_enabled then new.consented_at:=case when tg_op='UPDATE' and old.matching_enabled then old.consented_at else statement_timestamp() end;else new.consented_at:=null;end if;return new;
end;$f$;
create trigger preferences_prepare before insert or update on public.user_preferences for each row execute function app_private.prepare_preferences();
revoke all on function app_private.prepare_preferences() from public,anon,authenticated;

create function public.save_user_preferences(p_preferences jsonb) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare caller uuid:=auth.uid();saved public.user_preferences;
begin
 if caller is null then raise exception 'authentication required' using errcode='42501';end if;
 if jsonb_typeof(p_preferences) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_preferences) k where k not in ('region','age_band','diagnosed','insulin_use','matching_enabled','notice_version')) then raise exception 'invalid preference fields' using errcode='23514';end if;
 if jsonb_typeof(p_preferences->'matching_enabled') is distinct from 'boolean' or jsonb_typeof(p_preferences->'notice_version') is distinct from 'string'
  or (p_preferences->'region' is not null and jsonb_typeof(p_preferences->'region') not in ('string','null')) or (p_preferences->'age_band' is not null and jsonb_typeof(p_preferences->'age_band') not in ('string','null'))
  or (p_preferences->'diagnosed' is not null and jsonb_typeof(p_preferences->'diagnosed') not in ('boolean','null')) or (p_preferences->'insulin_use' is not null and jsonb_typeof(p_preferences->'insulin_use') not in ('boolean','null')) then raise exception 'invalid preference values' using errcode='23514';end if;
 insert into public.user_preferences(user_id,region,age_band,diagnosed,insulin_use,matching_enabled,notice_version)
 values(caller,p_preferences->>'region',p_preferences->>'age_band',(p_preferences->>'diagnosed')::boolean,(p_preferences->>'insulin_use')::boolean,(p_preferences->>'matching_enabled')::boolean,p_preferences->>'notice_version')
 on conflict(user_id) do update set region=excluded.region,age_band=excluded.age_band,diagnosed=excluded.diagnosed,insulin_use=excluded.insulin_use,matching_enabled=excluded.matching_enabled,notice_version=excluded.notice_version
 returning * into saved;
 return to_jsonb(saved);
end;$f$;
revoke all on function public.save_user_preferences(jsonb) from public,anon,authenticated;
grant execute on function public.save_user_preferences(jsonb) to authenticated;

create function public.save_meal_record(p_id uuid,p_meal jsonb,p_expected_updated_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $f$
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
  if oldmeal.updated_at is distinct from p_expected_updated_at then raise exception 'stale meal' using errcode='40001';end if;
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

create function public.import_glucose_csv(p_request_id uuid,p_file_sha256 text,p_records jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare caller uuid:=auth.uid();fingerprint text;batch public.import_batches;receipt public.import_requests;entry jsonb;normalized jsonb:='[]';position integer:=0;stamp timestamptz:=statement_timestamp();measured timestamptz;glucose integer;context_value text;slot text;memo_value text;
begin
 if caller is null or not exists(select 1 from public.user_consents where user_id=caller and policy_version='demo-v3') then raise exception 'consent required' using errcode='42501';end if;
 if p_request_id is null or p_file_sha256 is null or p_file_sha256!~'^[0-9a-f]{64}$' or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 1000 then raise exception 'invalid import' using errcode='23514';end if;
 -- 직접 RPC로 호출해도 시각 표현·공백·선택값의 생략 때문에 내용 지문이 달라지지 않게 해요.
 for entry in select value from jsonb_array_elements(p_records) loop
  if jsonb_typeof(entry) is distinct from 'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('glucose_mg_dl','measured_at','measurement_context','meal_slot','meal_memo')) then raise exception 'invalid record fields' using errcode='23514';end if;
  if jsonb_typeof(entry->'glucose_mg_dl') is distinct from 'number' or (entry->>'glucose_mg_dl')!~'^[0-9]+$' or jsonb_typeof(entry->'measured_at') is distinct from 'string' or jsonb_typeof(entry->'measurement_context') is distinct from 'string' or (entry->'meal_memo' is not null and jsonb_typeof(entry->'meal_memo') not in ('string','null')) then raise exception 'invalid record value' using errcode='23514';end if;
  if (entry->>'measured_at')!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then raise exception 'timestamp timezone required' using errcode='23514';end if;
  glucose:=(entry->>'glucose_mg_dl')::integer;measured:=(entry->>'measured_at')::timestamptz;context_value:=entry->>'measurement_context';slot:=entry->>'meal_slot';
  memo_value:=nullif(btrim(entry->>'meal_memo',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'');
  if glucose<=0 or not isfinite(measured) or context_value not in ('fasting','before_meal','after_meal','after_meal_2h','on_waking','before_sleep','nighttime','before_exercise','after_exercise','other') or char_length(memo_value)>500 or (slot is not null and (slot not in ('breakfast','lunch','dinner','snack') or context_value not in ('before_meal','after_meal','after_meal_2h'))) then raise exception 'invalid record range' using errcode='23514';end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('glucose_mg_dl',glucose,'measured_at',to_char(measured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'measurement_context',context_value,'meal_slot',slot,'meal_memo',memo_value));
 end loop;
 p_records:=normalized;
 -- 같은 계정의 동시 가져오기를 직렬화하여 중복 응답도 안정적으로 돌려줘요.
 perform pg_advisory_xact_lock(hashtextextended(caller::text,0));
 select encode(sha256(convert_to(jsonb_agg(value order by value::text)::text,'UTF8')),'hex') into fingerprint from jsonb_array_elements(p_records);
 select * into receipt from public.import_requests where user_id=caller and request_id=p_request_id;
 if receipt.request_id is not null then
  if receipt.file_sha256<>p_file_sha256 or receipt.content_sha256<>fingerprint then raise exception 'request content conflict' using errcode='23505';end if;
  select * into batch from public.import_batches where id=receipt.batch_id and user_id=caller;
  return jsonb_build_object('batch',to_jsonb(batch),'duplicate',true);
 end if;
 select * into batch from public.import_batches where user_id=caller and request_id=p_request_id;
 if batch.id is not null and (batch.file_sha256<>p_file_sha256 or batch.content_sha256<>fingerprint) then raise exception 'request content conflict' using errcode='23505';end if;
 if batch.id is null then select * into batch from public.import_batches where user_id=caller and (file_sha256=p_file_sha256 or content_sha256=fingerprint) limit 1;end if;
 if batch.id is not null then
  insert into public.import_requests(user_id,request_id,batch_id,file_sha256,content_sha256) values(caller,p_request_id,batch.id,p_file_sha256,fingerprint);
  return jsonb_build_object('batch',to_jsonb(batch),'duplicate',true);
 end if;
 insert into public.import_batches(user_id,request_id,file_sha256,content_sha256,row_count,imported_at,format_version) values(caller,p_request_id,p_file_sha256,fingerprint,jsonb_array_length(p_records),stamp,'csv-v1') returning * into batch;
 for entry in select value from jsonb_array_elements(p_records) loop
  position:=position+1;
  if jsonb_typeof(entry) is distinct from 'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('glucose_mg_dl','measured_at','measurement_context','meal_slot','meal_memo')) then raise exception 'invalid record fields' using errcode='23514';end if;
  if jsonb_typeof(entry->'glucose_mg_dl') is distinct from 'number' or (entry->>'glucose_mg_dl')!~'^[0-9]+$' or jsonb_typeof(entry->'measured_at') is distinct from 'string' or jsonb_typeof(entry->'measurement_context') is distinct from 'string' or (entry->'meal_memo' is not null and jsonb_typeof(entry->'meal_memo') not in ('string','null')) then raise exception 'invalid record value' using errcode='23514';end if;
  insert into public.glucose_records(id,user_id,glucose_mg_dl,measured_at,measurement_context,meal_slot,meal_memo,import_batch_id,source_row_number) values(gen_random_uuid(),caller,(entry->>'glucose_mg_dl')::integer,(entry->>'measured_at')::timestamptz,entry->>'measurement_context',entry->>'meal_slot',entry->>'meal_memo',batch.id,position);
 end loop;
 insert into public.import_requests(user_id,request_id,batch_id,file_sha256,content_sha256) values(caller,p_request_id,batch.id,p_file_sha256,fingerprint);
 return jsonb_build_object('batch',to_jsonb(batch),'duplicate',false);
end;$f$;

revoke all on function public.save_meal_record(uuid,jsonb,timestamptz),public.import_glucose_csv(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_meal_record(uuid,jsonb,timestamptz),public.import_glucose_csv(uuid,text,jsonb) to authenticated;

alter table public.import_batches enable row level security;alter table public.import_batches force row level security;
alter table public.import_requests enable row level security;alter table public.import_requests force row level security;
alter table public.food_catalog enable row level security;alter table public.food_catalog force row level security;
alter table public.meal_records enable row level security;alter table public.meal_records force row level security;
alter table public.meal_items enable row level security;alter table public.meal_items force row level security;
alter table public.user_preferences enable row level security;alter table public.user_preferences force row level security;
alter table public.benefit_rules enable row level security;alter table public.benefit_rules force row level security;
alter table public.health_articles enable row level security;alter table public.health_articles force row level security;
revoke all on public.import_batches,public.import_requests,public.food_catalog,public.meal_records,public.meal_items,public.user_preferences,public.benefit_rules,public.health_articles from public,anon,authenticated;
grant select on public.import_batches,public.import_requests,public.food_catalog,public.meal_records,public.meal_items,public.user_preferences,public.benefit_rules,public.health_articles to authenticated;
grant delete on public.meal_records,public.user_preferences to authenticated;
grant insert(user_id,region,age_band,diagnosed,insulin_use,matching_enabled,notice_version),update(region,age_band,diagnosed,insulin_use,matching_enabled,notice_version) on public.user_preferences to authenticated;
create policy imports_own on public.import_batches for select to authenticated using((select auth.uid())=user_id);
create policy import_requests_own on public.import_requests for select to authenticated using((select auth.uid())=user_id);
create policy meals_own on public.meal_records for select to authenticated using((select auth.uid())=user_id);
create policy meals_delete_own on public.meal_records for delete to authenticated using((select auth.uid())=user_id);
create policy items_own on public.meal_items for select to authenticated using((select auth.uid())=user_id);
create policy preferences_own on public.user_preferences for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy foods_approved on public.food_catalog for select to authenticated using(status='approved');
create policy benefits_current on public.benefit_rules for select to authenticated using(status='approved' and review_due_at>now() and (valid_from is null or valid_from<=(now() at time zone 'Asia/Seoul')::date) and (valid_until is null or valid_until>=(now() at time zone 'Asia/Seoul')::date));
create policy news_approved on public.health_articles for select to authenticated using(status='approved');
commit;
