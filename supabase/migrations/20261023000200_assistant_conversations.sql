begin;

-- 질문과 답변은 계정에 저장한다는 별도 안내에 동의한 대화방에만 보관해요.
create table public.assistant_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  notice_version text not null check (notice_version = 'assistant-chat-v1'),
  consented_at timestamptz not null check (isfinite(consented_at)),
  created_at timestamptz not null check (isfinite(created_at)),
  updated_at timestamptz not null check (isfinite(updated_at)),
  unique (id, user_id)
);
create index assistant_conversations_owner_updated on public.assistant_conversations(user_id, updated_at desc, id);

create function public.valid_assistant_answer(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $function$
declare citation jsonb; page jsonb; key text; ids text[] := '{}';
begin
  if value is null or jsonb_typeof(value) is distinct from 'object'
    or octet_length(value::text) > 65536
    or exists (select 1 from jsonb_object_keys(value) k where k not in ('kind','answer','citations','draftPreview'))
    or value->>'kind' not in ('answer','no_evidence','unsupported','safety')
    or jsonb_typeof(value->'kind') is distinct from 'string'
    or jsonb_typeof(value->'answer') is distinct from 'string'
    or char_length(value->>'answer') not between 1 and 12000
    or jsonb_typeof(value->'draftPreview') is distinct from 'boolean'
    or jsonb_typeof(value->'citations') is distinct from 'array' then return false; end if;
  if jsonb_array_length(value->'citations') > 8 then return false; end if;
  for citation in select * from jsonb_array_elements(value->'citations') loop
    if jsonb_typeof(citation) is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(citation) k where k not in
        ('id','title','publisher','url','pdfPages','attribution','licenseLabel','licenseUrl','retrievedAt'))
      or jsonb_typeof(citation->'id') is distinct from 'string' or char_length(citation->>'id') not between 1 and 128
      or (citation->>'id') = any(ids)
      or jsonb_typeof(citation->'title') is distinct from 'string' or char_length(citation->>'title') not between 1 and 500
      or jsonb_typeof(citation->'publisher') is distinct from 'string' or char_length(citation->>'publisher') not between 1 and 200
      or jsonb_typeof(citation->'url') is distinct from 'string'
      or char_length(citation->>'url') not between 1 and 2048
      or (citation->>'url') !~* '^https://[^/@[:space:]]+([/?#]|$)'
      or jsonb_typeof(citation->'pdfPages') is distinct from 'array' then return false; end if;
    ids := array_append(ids, citation->>'id');
    if jsonb_array_length(citation->'pdfPages') > 24 then return false; end if;
    for page in select * from jsonb_array_elements(citation->'pdfPages') loop
      if jsonb_typeof(page) is distinct from 'number' or page::text !~ '^[0-9]+$'
        or page::numeric not between 1 and 100000 then return false; end if;
    end loop;
    foreach key in array array['attribution','licenseLabel','licenseUrl','retrievedAt'] loop
      if citation ? key and (jsonb_typeof(citation->key) is distinct from 'string'
        or char_length(citation->>key) < 1) then return false; end if;
    end loop;
    if (citation ? 'attribution' and char_length(citation->>'attribution') > 2000)
      or (citation ? 'licenseLabel' and char_length(citation->>'licenseLabel') > 200)
      or (citation ? 'licenseUrl' and (char_length(citation->>'licenseUrl') > 2048
        or (citation->>'licenseUrl') !~* '^https://[^/@[:space:]]+([/?#]|$)')) then return false; end if;
    if citation ? 'retrievedAt' then
      if (citation->>'retrievedAt') !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        or not isfinite((citation->>'retrievedAt')::timestamptz) then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$function$;

create table public.assistant_turns (
  id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 1000 and question ~ '[^[:space:]]'),
  answer jsonb,
  status text not null check (status in ('pending','completed','failed')),
  error text,
  attempt_id uuid not null,
  created_at timestamptz not null check (isfinite(created_at)),
  updated_at timestamptz not null check (isfinite(updated_at)),
  primary key (conversation_id, id),
  foreign key (conversation_id, user_id) references public.assistant_conversations(id, user_id) on delete cascade,
  constraint assistant_turn_state check (
    (status = 'completed' and answer is not null and public.valid_assistant_answer(answer) and error is null)
    or (status = 'pending' and answer is null and error is null)
    or (status = 'failed' and answer is null and error is not null and char_length(error) between 1 and 300)
  )
);
create index assistant_turns_owner_room on public.assistant_turns(user_id, conversation_id, created_at, id);
create unique index assistant_turns_one_pending on public.assistant_turns(conversation_id) where status = 'pending';

alter table public.assistant_conversations enable row level security;
alter table public.assistant_conversations force row level security;
alter table public.assistant_turns enable row level security;
alter table public.assistant_turns force row level security;
revoke all on public.assistant_conversations, public.assistant_turns from public, anon, authenticated;
grant select on public.assistant_conversations to authenticated;
-- Internal attempt tokens are not exposed through normal table reads.
grant select (id, conversation_id, user_id, question, answer, status, error, created_at, updated_at)
  on public.assistant_turns to authenticated;
create policy assistant_conversations_read_own on public.assistant_conversations for select
  to authenticated using ((select auth.uid()) = user_id);
create policy assistant_turns_read_own on public.assistant_turns for select
  to authenticated using ((select auth.uid()) = user_id);

create function public.assistant_room_json(p_id uuid, p_owner uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object('id', r.id, 'user_id', r.user_id, 'title', r.title,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'turns', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'question', t.question,
        'answer', t.answer, 'status', t.status, 'error', t.error, 'created_at', t.created_at,
        'updated_at', t.updated_at) order by t.created_at, t.id)
      from public.assistant_turns t where t.conversation_id = r.id and t.user_id = p_owner
    ), '[]'::jsonb))
  from public.assistant_conversations r where r.id = p_id and r.user_id = p_owner;
$function$;

create function public.create_assistant_conversation(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare caller uuid := auth.uid(); room_id uuid; previous public.assistant_conversations%rowtype; write_time timestamptz;
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid object' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('id','allow_storage','notice_version'))
    or jsonb_typeof(p_input->'id') is distinct from 'string'
    or (p_input->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_input->'allow_storage' is distinct from 'true'::jsonb
    or p_input->>'notice_version' is distinct from 'assistant-chat-v1' then
    raise exception 'invalid room or storage consent' using errcode = '23514';
  end if;
  room_id := (p_input->>'id')::uuid;
  -- Locking the account also serializes first creates so the 50-room limit
  -- cannot be exceeded by requests from two devices.
  perform 1 from auth.users where id = caller for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_consents where user_id = caller and policy_version = 'demo-v3') then
    raise exception 'current application consent required' using errcode = '42501';
  end if;
  select * into previous from public.assistant_conversations where id = room_id for update;
  if found then
    if previous.user_id <> caller then raise exception 'room unavailable' using errcode = 'P0002'; end if;
    return public.assistant_room_json(room_id, caller);
  end if;
  if (select count(*) from public.assistant_conversations where user_id = caller) >= 50 then
    raise exception 'room limit reached' using errcode = 'PT429';
  end if;
  write_time := clock_timestamp();
  insert into public.assistant_conversations(id,user_id,title,notice_version,consented_at,created_at,updated_at)
    values(room_id,caller,'새 대화','assistant-chat-v1',write_time,write_time,write_time);
  return public.assistant_room_json(room_id, caller);
end;
$function$;

create function public.delete_assistant_conversation(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_id is null then raise exception 'room id required' using errcode = '23514'; end if;
  perform 1 from auth.users where id = caller for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  delete from public.assistant_conversations where id = p_id and user_id = caller;
end;
$function$;

create function public.begin_assistant_turn(p_room_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  caller uuid := auth.uid(); saved_room public.assistant_conversations%rowtype;
  saved_turn public.assistant_turns%rowtype; pending_turn public.assistant_turns%rowtype;
  turn_id uuid; question_text text; expected timestamptz; write_time timestamptz; attempt uuid; existing boolean;
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid object' using errcode = '23514'; end if;
  if p_room_id is null or exists (select 1 from jsonb_object_keys(p_input) k where k not in ('id','question','expected_updated_at'))
    or jsonb_typeof(p_input->'id') is distinct from 'string'
    or (p_input->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'question') is distinct from 'string'
    or char_length(p_input->>'question') not between 1 and 1000
    or (p_input->>'question') !~ '[^[:space:]]'
    or jsonb_typeof(p_input->'expected_updated_at') is distinct from 'string'
    or (p_input->>'expected_updated_at') !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'invalid turn' using errcode = '23514';
  end if;
  expected := (p_input->>'expected_updated_at')::timestamptz;
  if not isfinite(expected) then raise exception 'invalid version' using errcode = '23514'; end if;
  turn_id := (p_input->>'id')::uuid;
  question_text := regexp_replace(p_input->>'question', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform 1 from auth.users where id = caller for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_consents where user_id = caller and policy_version = 'demo-v3') then
    raise exception 'current application consent required' using errcode = '42501';
  end if;
  select * into saved_room from public.assistant_conversations where id = p_room_id and user_id = caller for update;
  if not found then raise exception 'room unavailable' using errcode = 'P0002'; end if;
  if saved_room.notice_version <> 'assistant-chat-v1' then raise exception 'storage consent required' using errcode = '42501'; end if;
  select * into saved_turn from public.assistant_turns where conversation_id = p_room_id and id = turn_id for update;
  existing := found;
  if existing and saved_turn.question <> question_text then raise exception 'different replay content' using errcode = 'PT409'; end if;
  if existing and saved_turn.status = 'completed' then
    return jsonb_build_object('room', public.assistant_room_json(p_room_id,caller), 'attemptId', saved_turn.attempt_id, 'alreadyCompleted', true);
  end if;
  if expected is distinct from saved_room.updated_at then raise exception 'stale conversation' using errcode = 'PT409'; end if;
  select * into pending_turn from public.assistant_turns where conversation_id = p_room_id and status = 'pending' for update;
  if found and (pending_turn.id <> turn_id or pending_turn.updated_at > clock_timestamp() - interval '180 seconds') then
    raise exception 'turn already pending' using errcode = 'PT423';
  end if;
  if existing and saved_turn.id is distinct from (select id from public.assistant_turns where conversation_id=p_room_id order by created_at desc,id desc limit 1) then
    raise exception 'retry only the last turn' using errcode = 'PT409';
  end if;
  if not existing and (select count(*) from public.assistant_turns where conversation_id = p_room_id) >= 100 then
    raise exception 'turn limit reached' using errcode = 'PT429';
  end if;
  write_time := greatest(clock_timestamp(), saved_room.updated_at + interval '1 microsecond');
  attempt := gen_random_uuid();
  insert into public.assistant_turns(id,conversation_id,user_id,question,answer,status,error,attempt_id,created_at,updated_at)
    values(turn_id,p_room_id,caller,question_text,null,'pending',null,attempt,coalesce(saved_turn.created_at,write_time),write_time)
    on conflict(conversation_id,id) do update set answer=null,status='pending',error=null,attempt_id=excluded.attempt_id,updated_at=excluded.updated_at;
  update public.assistant_conversations set updated_at=write_time,
    title=case when (select count(*) from public.assistant_turns where conversation_id=p_room_id)=1
      then left(regexp_replace(question_text,'[[:space:]]+',' ','g'),60) else title end where id=p_room_id and user_id=caller;
  return jsonb_build_object('room', public.assistant_room_json(p_room_id,caller), 'attemptId', attempt, 'alreadyCompleted', false);
end;
$function$;

create function public.finish_assistant_turn(p_room_id uuid,p_turn_id uuid,p_attempt_id uuid,p_answer jsonb,p_error text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare caller uuid:=auth.uid(); saved_room public.assistant_conversations%rowtype;
  saved_turn public.assistant_turns%rowtype; write_time timestamptz;
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_room_id is null or p_turn_id is null or p_attempt_id is null
    or (p_answer is null and (p_error is null or char_length(p_error) not between 1 and 300))
    or (p_answer is not null and (not public.valid_assistant_answer(p_answer) or p_error is not null)) then
    raise exception 'invalid answer' using errcode = '23514';
  end if;
  perform 1 from auth.users where id = caller for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_consents where user_id = caller and policy_version = 'demo-v3') then
    raise exception 'current application consent required' using errcode = '42501';
  end if;
  select * into saved_room from public.assistant_conversations where id=p_room_id and user_id=caller for update;
  if not found then raise exception 'room unavailable' using errcode = 'P0002'; end if;
  select * into saved_turn from public.assistant_turns where conversation_id=p_room_id and id=p_turn_id and user_id=caller for update;
  if not found then raise exception 'turn unavailable' using errcode = 'P0002'; end if;
  if saved_turn.attempt_id <> p_attempt_id then raise exception 'stale attempt' using errcode = 'PT409'; end if;
  if saved_turn.status <> 'pending' then return public.assistant_room_json(p_room_id,caller); end if;
  write_time:=greatest(clock_timestamp(),saved_room.updated_at+interval '1 microsecond');
  update public.assistant_turns set answer=p_answer,error=p_error,
    status=case when p_answer is null then 'failed' else 'completed' end,updated_at=write_time
    where conversation_id=p_room_id and id=p_turn_id and user_id=caller;
  update public.assistant_conversations set updated_at=write_time where id=p_room_id and user_id=caller;
  return public.assistant_room_json(p_room_id,caller);
end;
$function$;

revoke all on function public.valid_assistant_answer(jsonb) from public,anon,authenticated;
revoke all on function public.assistant_room_json(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_assistant_conversation(jsonb) from public,anon,authenticated;
revoke all on function public.delete_assistant_conversation(uuid) from public,anon,authenticated;
revoke all on function public.begin_assistant_turn(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.finish_assistant_turn(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_assistant_conversation(jsonb) to authenticated;
grant execute on function public.delete_assistant_conversation(uuid) to authenticated;
grant execute on function public.begin_assistant_turn(uuid,jsonb) to authenticated;
grant execute on function public.finish_assistant_turn(uuid,uuid,uuid,jsonb,text) to authenticated;

commit;
