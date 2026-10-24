begin;

-- Preserve existing saved answers while admitting the reviewed citation metadata.
create or replace function public.valid_assistant_answer(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $function$
declare citation jsonb; page jsonb; key text; ids text[] := '{}';
begin
  if value is null or jsonb_typeof(value) is distinct from 'object'
    or octet_length(value::text) > 65536
    or exists (select 1 from jsonb_object_keys(value) k where k not in ('kind','answer','citations','draftPreview','sourceSupplemented'))
    or value->>'kind' not in ('answer','no_evidence','unsupported','safety')
    or jsonb_typeof(value->'kind') is distinct from 'string'
    or jsonb_typeof(value->'answer') is distinct from 'string'
    or char_length(value->>'answer') not between 1 and 12000
    or jsonb_typeof(value->'draftPreview') is distinct from 'boolean'
    or (value ? 'sourceSupplemented' and jsonb_typeof(value->'sourceSupplemented') is distinct from 'boolean')
    or jsonb_typeof(value->'citations') is distinct from 'array' then return false; end if;
  if jsonb_array_length(value->'citations') > 8 then return false; end if;
  for citation in select * from jsonb_array_elements(value->'citations') loop
    if jsonb_typeof(citation) is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(citation) k where k not in
        ('id','title','publisher','url','pdfPages','attribution','licenseLabel','licenseUrl','retrievedAt',
         'section','evidenceRole','reuseLabel','reuseUrl','adaptationNotice'))
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
    foreach key in array array['attribution','licenseLabel','licenseUrl','retrievedAt','section','evidenceRole','reuseLabel','reuseUrl','adaptationNotice'] loop
      if citation ? key and (jsonb_typeof(citation->key) is distinct from 'string'
        or char_length(citation->>key) < 1) then return false; end if;
    end loop;
    if (citation ? 'attribution' and char_length(citation->>'attribution') > 2000)
      or (citation ? 'licenseLabel' and char_length(citation->>'licenseLabel') > 200)
      or (citation ? 'licenseUrl' and (char_length(citation->>'licenseUrl') > 2048
        or (citation->>'licenseUrl') !~* '^https://[^/@[:space:]]+([/?#]|$)')) then return false; end if;
    if (citation ? 'section' and char_length(citation->>'section') > 2000)
      or (citation ? 'evidenceRole' and char_length(citation->>'evidenceRole') > 100)
      or (citation ? 'reuseLabel' and char_length(citation->>'reuseLabel') > 200)
      or (citation ? 'adaptationNotice' and char_length(citation->>'adaptationNotice') > 2000)
      or (citation ? 'reuseUrl' and (char_length(citation->>'reuseUrl') > 2048
        or (citation->>'reuseUrl') !~* '^https://[^/@[:space:]]+([/?#]|$)')) then return false; end if;
    if citation ? 'retrievedAt' then
      if (citation->>'retrievedAt') !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        or not isfinite((citation->>'retrievedAt')::timestamptz) then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$function$;

revoke all on function public.valid_assistant_answer(jsonb) from public, anon, authenticated;

commit;
