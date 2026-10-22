"""Record local source identities without inventing missing download history.

Website metadata below was reviewed on 2026-10-21. Rerunning this script
refreshes local file observations, not the website review or license decision.
"""
import hashlib
import json
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/research'
REVIEW_DATE = '2026-10-21'
OBSERVED_AT = datetime.now().astimezone().isoformat(timespec='seconds')
KNHANES = 'https://knhanes.kdca.go.kr/knhanes/main.do'
FOOD_API = 'https://www.data.go.kr/data/15127578/openapi.do'
FOOD_STANDARD = 'https://www.data.go.kr/data/15100064/standard.do'
NUTRIENT = 'https://various.foodsafetykorea.go.kr/nutrient/'
NUTRIENT_DOWNLOAD = NUTRIENT + 'general/down/list.do'
CGM_BASE = 'https://physionet.org/files/cgmacros/1.0.0/'
CGM_PATH = Path('physionet.org/files/cgmacros/1.0.0')
CGM_CHECKSUMS = {
    'CGMacros_dateshifted365.zip': '05c8b0e6f1a2757050aced55ce4bf6ab2ac9b30f2fd8ca193056812d9c621d4d',
    'DataDictionary.pdf': 'f161ff8df4bd95efa79d3daa8aba5eab754df287ab0f4dfc74bce156f6862c1a',
    'DataDictionary_Bio.csv': '2d5b4c27873284ddbf218df51172b69ffa9caf6e97a3a122977b7a2761da4c61',
    'DataDictionary_CGMacros-00X.csv': 'db7bf114d61b90fc5de43fed5e5cd6ba33af37e900a706e1b5747d7b0ffac3f8',
    'DataDictionary_Gut_Health_Test.csv': 'fbc7555aacb93b2fb107b65db8d4a3d88d3546e7818fe5378fd2840cdceeb1b0',
    'DataDictionary_Microbes.csv': 'eb75be859489f59f6b81c3f8d29c307f078498655b4ae0878e1aa49a57d61f76',
    'LICENSE.txt': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
}


def digest(stream):
    h = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(block)
    return h.hexdigest()


def file_record(relative, expected=None):
    path = ROOT / relative
    before = path.stat()
    with path.open('rb') as stream:
        value = digest(stream)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f'Source changed while reading: {relative}')
    if expected and value != expected:
        raise ValueError(f'Previously reviewed source has changed: {relative}')
    return {'path': Path(relative).as_posix(), 'bytes': after.st_size,
            'sha256': value, 'hash_status': 'local_file_hashed',
            'observed_at': OBSERVED_AT}


def xlsx_metadata(path):
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
          'd': 'http://purl.org/dc/terms/'}
    with zipfile.ZipFile(ROOT / path) as z:
        workbook = ET.fromstring(z.read('xl/workbook.xml'))
        result = {'sheet_names': [s.attrib['name'] for s in workbook.findall('s:sheets/s:sheet', ns)]}
        if 'docProps/core.xml' in z.namelist():
            core = ET.fromstring(z.read('docProps/core.xml'))
            result['embedded_created_at'] = core.findtext('d:created', namespaces=ns)
            result['embedded_modified_at'] = core.findtext('d:modified', namespaces=ns)
    result['scope'] = 'Workbook metadata only; row counts, cell values, units and completeness not audited.'
    return result


def entry(ident, title, publisher, purpose, confidence, urls, files, pending=None, license=None, **extra):
    return {'id': ident, 'title': title, 'publisher': publisher, 'purpose': purpose,
            'identity_status': confidence, 'official_reference_urls': urls,
            'original_download_url': None, 'acquired_at': None,
            'license': license or {'status': 'not_verified_for_this_local_artifact', 'label': None},
            'files': files, 'pending': pending or [], **extra}


def build():
    chatbot = json.loads((OUT / 'chatbot_knowledge.json').read_text(encoding='utf-8'))
    profile = json.loads((ROOT / 'docs/data_profile.json').read_text(encoding='utf-8'))
    references = json.loads((OUT / 'references.json').read_text(encoding='utf-8'))
    sources = []
    bundle_file = file_record('data/csv.zip', profile['archive_sha256'])
    members = {}
    with zipfile.ZipFile(ROOT / 'data/csv.zip') as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            with z.open(info) as stream:
                value = digest(stream)
            members[info.filename] = {'path': 'data/csv.zip', 'archive_member': info.filename,
                                      'bytes': info.file_size, 'sha256': value,
                                      'hash_scope': 'uncompressed_archive_member'}
    sources.append(entry('CSV_BUNDLE', '사용자 제공 CSV 묶음', '원자료별로 구분',
                         '최초 참고 데이터 보존', 'user_provided_bundle', [], [bundle_file],
                         ['최초 전달자·원본 다운로드 주소·열 선택 및 행 필터를 기록해야 함.'],
                         archive_members=list(members.values())))
    for ident, member, publisher, purpose, urls in [
        ('KNHANES_HEALTH_CSV_2024', '2024_건강검진_개인별.csv', '질병관리청(사용자 전달)', '집단 검진 지표 탐색', [KNHANES]),
        ('KNHANES_INTAKE_CSV_2024', '2024_식품섭취_기록별.csv', '질병관리청(사용자 전달)', '집단 식품 섭취 현황 탐색', [KNHANES]),
        ('FOOD_CSV', '식품영양성분_핵심컬럼.csv', '식품의약품안전처(제공기관명 칼럼 확인)', '기존 검색·환산 검증용 참고본; 주 데이터는 공식 XLSX로 전환 예정', [FOOD_API, FOOD_STANDARD, NUTRIENT]),
    ]:
        p = profile['csv_profiles'][member]
        sources.append(entry(ident, member, publisher, purpose, 'provider_or_format_checked_origin_unresolved', urls,
                             [members[member]], ['정확한 다운로드 URL', '실제 입수일', '추출 시점·필터·열 선택 과정', '해당 추출본에 적용되는 이용조건'],
                             acquisition_channel='공공데이터포털(사용자 전달)' if ident == 'FOOD_CSV' else '질병관리청 자료(사용자 전달)',
                             rows=p['rows'], columns=p['columns'], profile_path='docs/data_profile.json'))
    inventory = json.loads((ROOT / 'data/metadata/knhanes/inventory.json').read_text(encoding='utf-8'))
    for item in inventory:
        sources.append(entry(f"KNHANES_{item['year']}_{item['kind']}", f"국민건강영양조사 {item['year']} {item['kind']} SAS",
                             '질병관리청(사용자 전달·자료 형식 확인)', '통합·식품섭취 원시자료와 변수 해석',
                             'user_reported_and_sas_metadata_checked', [KNHANES],
                             [file_record('data/' + item['archive'], item['archive_sha256'])],
                             ['원본 다운로드 상세 페이지·실제 입수일', '해당 배포본 이용약관 확인'],
                             survey_year=item['year'], rows=item['rows'], columns_count=item['columns'],
                             extracted_metadata_inventory='data/metadata/knhanes/inventory.json',
                             extracted_dataset_path='data/' + item['dataset'],
                             scope='압축 원본 해시는 재확인. SAS 변수·추출 파일 해시는 기존 inventory의 점검 결과를 참조.'))
    manuals = [d for d in references['local_data_documents'] if d['type'] == 'raw_data_manual']
    sources.append(entry('KNHANES_MANUAL_9', '국민건강영양조사 제9기(2022-2024) 원시자료 이용지침서', '질병관리청',
                         '변수 정의·복합표본 설계·가중치 해석', 'document_cover_and_selected_sections_checked', [KNHANES],
                         [file_record(m['path'], m['sha256']) for m in manuals], ['정확한 다운로드 상세 페이지·실제 입수일', '서비스 재배포 조건'],
                         first_release='2025-12', updated='2026-07', pdf_page_count=255,
                         duplicate_note='3개 파일의 해시가 같음. 원본을 모두 보존.'))
    for item in references['local_data_documents']:
        if item['type'] != 'nutrition_codebook':
            continue
        files = [file_record(item['path'], item['sha256'])]
        if item['year'] == 2024:
            archived = members['2024_영양조사_코드자료집.xlsx']
            if archived['sha256'] != item['sha256']:
                raise ValueError('2024 nutrition codebook copies differ')
            files.append(archived)
        sources.append(entry(f"KNHANES_CODEBOOK_{item['year']}", f"{item['year']} 영양조사 코드자료집", '질병관리청',
                             '해당 연도 조사 식품·음식코드 해석', 'workbook_sheets_and_hash_checked', [KNHANES], files,
                             ['정확한 다운로드 상세 페이지·실제 입수일', '해당 배포본 이용조건'], survey_year=item['year'], sheet_names=item['sheets']))
    for item in chatbot['sources']:
        if not item.get('pdf_page_count'):
            continue
        metadata = {k: v for k, v in item.items() if k not in {'id', 'title', 'publisher', 'kind', 'local_path', 'sha256', 'official_url', 'role'}}
        sources.append(entry(item['id'], item['title'], item['publisher'], item['role'],
                             'official_document_identified_selected_sections_checked', [item['official_url']],
                             [file_record(item['local_path'], item['sha256'])], ['실제 입수일·원문 및 표·이미지의 서비스 재사용 조건'],
                             source_page_url=item['official_url'], website_metadata_reviewed_at=REVIEW_DATE,
                             reference_metadata=metadata))
    extras = [
        ('MFDS_FOOD_XLSX', '20260828_음식DB_19617건.xlsx', '식품의약품안전처', [NUTRIENT_DOWNLOAD, FOOD_STANDARD],
         '음식 검색·영양정보의 주 전처리 원본', 'primary_preprocessing_source_planned'),
        ('MFDS_PROCESSED_XLSX', '20260929_가공식품DB_323197건.xlsx', '식품의약품안전처', [NUTRIENT_DOWNLOAD, FOOD_STANDARD],
         '가공식품·제품 검색의 주 전처리 원본', 'primary_preprocessing_source_planned'),
        ('MFDS_SUPPLEMENT_XLSX', '20260623_건강기능식품DB_5556건 (3).xlsx', '식품의약품안전처', [NUTRIENT_DOWNLOAD],
         '건강기능식품 별도 보관; 초기 음식 검색 범위에서 제외', 'optional_separate_source'),
        ('RDA_COMPOSITION_XLSX', '식품성분표(10개정판).xlsx', '농촌진흥청', ['https://koreanfood.rda.go.kr', FOOD_STANDARD],
         '기본 식품·원재료의 영양정보 조회; 10.4판 사용', 'basic_food_nutrition_source'),
        ('NIFS_FISH_PDF', '표준수산식품DB.pdf', '국립수산과학원 관련 자료', [FOOD_STANDARD],
         '수산식품 참고 자료; 초기 엑셀 전처리의 필수 입력 아님', 'reference_only_planned'),
    ]
    for ident, name, publisher, urls, purpose, adoption in extras:
        relative = 'data/' + name
        extra = {'file_metadata': xlsx_metadata(relative)} if name.endswith('.xlsx') else {}
        confidence = 'local_file_identified_origin_and_quality_pending'
        if ident.startswith('MFDS_'):
            confidence = 'official_distribution_user_confirmed_content_review_pending'
            extra['origin_evidence'] = {
                'type': 'user_confirmation', 'confirmed_at': REVIEW_DATE,
                'scope': '이미 제공한 식약처 공식 배포 엑셀이라는 사용자 확인. 실제 입수일을 뜻하지 않음.',
            }
        pending = ['파일별 상세 배포 URL·실제 입수일·이용조건 기록', '머리글 대응·단위·결측·중복·코드 호환성 점검']
        if ident == 'RDA_COMPOSITION_XLSX':
            confidence = 'official_workbook_description_identified'
            extra.update(
                version='10.4', year_in_description=2026,
                origin_evidence={'type': 'local_workbook_description', 'checked_at': REVIEW_DATE,
                                 'locator': 'DB 설명 시트의 국가표준식품성분 DB 10.4 설명문 이미지'},
                license={'status': 'identified_in_local_workbook_description', 'label': '공공누리 제1유형: 출처표시',
                         'locator': 'DB 설명 시트 설명문 하단',
                         'attribution': '농촌진흥청, 2026. 국가표준식품성분 DB 10.4. https://koreanfood.rda.go.kr'})
            pending = ['파일별 상세 배포 URL·실제 입수일 기록', '다른 식품 DB와 연결할 때 코드·범위 별도 검증', '핵심 7개 외 성분의 정규화는 별도 작업']
            prepared_dir = ROOT / 'data/processed/food_composition_10_4'
            if (prepared_dir / 'manifest.json').exists():
                prepared = json.loads((prepared_dir / 'manifest.json').read_text(encoding='utf-8'))
                if prepared['source']['sha256'] != file_record(relative)['sha256']:
                    raise ValueError('RDA processed dataset source hash mismatch')
                for info in prepared['files']:
                    file_record(prepared_dir / info['name'], info['sha256'])
                extra['processed_dataset'] = {
                    'manifest': 'data/processed/food_composition_10_4/manifest.json',
                    'catalog_id': prepared['catalog_id'], 'rows': prepared['profile']['rows'],
                    'core_nutrient_count': len(prepared['core_columns']), 'status': 'prepared_outputs_hash_checked',
                }
        sources.append(entry(ident, name, publisher, purpose, confidence,
                             urls, [file_record(relative)], pending,
                             adoption_status=adoption, **extra))
    cgm_files = []
    for name, expected in CGM_CHECKSUMS.items():
        relative = CGM_PATH / name
        path = ROOT / relative
        if not path.exists():
            cgm_files.append({'path': relative.as_posix(), 'expected_sha256': expected, 'hash_status': 'not_downloaded'})
        elif name.endswith('.zip') and not zipfile.is_zipfile(path):
            cgm_files.append({'path': relative.as_posix(), 'bytes_at_observation': path.stat().st_size,
                              'expected_sha256': expected, 'hash_status': 'download_incomplete_not_hashed',
                              'observed_at': OBSERVED_AT})
        else:
            record = file_record(relative, expected)
            record.update(expected_sha256=expected, hash_status='matches_official_sha256')
            cgm_files.append(record)
    sources.append(entry('CGMACROS_1_0_0', 'CGMacros: a scientific dataset for personalized nutrition and diet monitoring',
                         'Gutierrez-Osuna, Kerr, Mortazavi, Das / PhysioNet', '연속혈당·식사 반응 분석의 선택 확장 자료',
                         'official_distribution_and_license_identified', ['https://physionet.org/content/cgmacros/1.0.0/', CGM_BASE + 'SHA256SUMS.txt'],
                         cgm_files, ['ZIP 다운로드 완료 후 공식 체크섬 재확인', '실제 데이터의 단위·시간·결측 점검'],
                         license={'status': 'identified_on_official_dataset_page', 'label': 'CC-BY-NC-SA-4.0',
                                  'url': 'https://physionet.org/content/cgmacros/1.0.0/',
                                  'note': '공식 웹페이지의 라이선스 표시를 기준으로 기록. LICENSE.txt가 빈 파일인 점은 공개 체크섬과도 일치.'},
                         version='1.0.0', published_at='2025-01-28', website_metadata_reviewed_at=REVIEW_DATE,
                         doi='10.13026/3z8q-x658', dates_shifted=True,
                         original_download_url=CGM_BASE,
                         acquisition_method='wget -r -N -c -np ' + CGM_BASE))
    for f in cgm_files:
        f['download_url'] = CGM_BASE + Path(f['path']).name
    by_id = {s['id']: s for s in sources}
    if len(by_id) != len(sources):
        raise ValueError('Duplicate source IDs')
    payload = {
        'schema_version': '1.1', 'local_observed_at': OBSERVED_AT, 'website_metadata_reviewed_at': REVIEW_DATE,
        'scope': '로컬 data 최상위 원본 23개와 csv.zip 내부 파일, 별도 CGMacros 다운로드. 기존 문헌 XML·논문 서지는 references.json을 참조.',
        'date_policy': '실제 입수일이 확인되지 않으면 null. 파일 수정 시각·브라우저 인쇄일·파일명 날짜·웹 수정일을 입수일로 대체하지 않음.',
        'url_policy': '공식 관련 URL과 이 로컬 파일의 실제 다운로드 URL을 구분. 브라우저의 조회 가능한 다운로드 기록에서는 파일별 입수 경로를 복원하지 못함.',
        'license_policy': '공개 페이지 열람과 특정 파일의 재사용 허락은 구분. 관련 API 조건을 원출처 미확정 CSV에 자동 적용하지 않음.',
        'food_source_policy': {
            'updated_at': REVIEW_DATE,
            'primary_source_ids': ['MFDS_FOOD_XLSX', 'MFDS_PROCESSED_XLSX'],
            'ingredient_complement_source_id': 'RDA_COMPOSITION_XLSX',
            'csv_role': '기존 검색·환산 검증용 참고본. CSV 추출 경로 복원이 공식 엑셀 전처리의 선행 조건은 아님.',
            'prepared_basic_food_dataset': by_id['RDA_COMPOSITION_XLSX'].get('processed_dataset'),
            'processing_status': '기존 5만 행 가공본은 FOOD_CSV 기반으로 보존. 식약처 음식·가공식품 엑셀 전처리는 대기. 별도 RDA 가공본 상태는 prepared_basic_food_dataset 참조.',
        },
        'related_official_sources': [
            {'id': 'MFDS_API_REFERENCE', 'url': FOOD_API, 'title': '식품의약품안전처_식품영양성분DB정보',
             'page_updated_at': '2026-09-16', 'license_label_on_page': '이용허락범위 제한 없음',
             'applies_to_local_food_csv': '원본 동일성 미확정으로 자동 적용하지 않음', 'checked_at': REVIEW_DATE},
            {'id': 'FOOD_STANDARD_REFERENCE', 'url': FOOD_STANDARD, 'title': '전국통합식품영양성분정보표준데이터',
             'page_updated_at': '2026-10-06', 'role': '관련 제공기관·통합 항목 확인. 특정 로컬 파일의 출처 확정 근거는 아님.', 'checked_at': REVIEW_DATE},
        ],
        'related_registries': ['docs/research/chatbot_knowledge.json', 'docs/research/references.json', 'docs/data_profile.json', 'data/metadata/knhanes/inventory.json'],
        'sources': sources,
    }
    (OUT / 'data_sources.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    render(payload)
    return payload


def render(payload):
    lines = [
        '# 프로젝트 데이터 출처 등록부', '',
        f"공식 웹 메타데이터 확인: {REVIEW_DATE} · 로컬 파일 관찰: {OBSERVED_AT}", '',
        '[전체 출처·해시 JSON](data_sources.json) · [데이터 활용안](CHATBOT_DATA_PLAN.md) · [시연용 가상 기록](../DEMO_DATA.md)', '',
        '공식 관련 배포처를 찾은 것과 현재 로컬 파일의 정확한 다운로드 경로를 확인한 것을 구분했다. **모르는 입수일·다운로드 URL·추출 조건은 미확인으로 남겼다.** 파일 수정 시각이나 파일명 날짜를 실제 입수일로 기록하지 않았다.', '',
        '## 먼저 확인할 결과', '',
        '- 식약처 공식 배포 엑셀을 이미 제공했다는 사용자 확인을 반영했다. 음식 DB·가공식품 DB를 주 전처리 원본으로 삼고, 건강기능식품 DB는 초기 음식 검색과 분리해 보관한다. 추가 다운로드를 선행할 필요는 없다.',
        '- 현재 5만 행 JSONL은 기존 CSV 기반의 참고·검증용 가공본이다. 공식 엑셀 기반 가공본으로 교체한 상태는 아니다. 다음 작업은 보유 엑셀의 머리글·단위·결측·중복을 점검해 필요한 칼럼을 추출하는 것이다.',
        '- 식품 CSV는 50,000행의 제공기관명 칼럼이 식품의약품안전처임을 확인했다. 공공데이터포털은 사용자 전달 기준 입수 경로다. 최초 상세 URL·입수일·추출 시점·필터는 미확인이다.',
        f'- [식약처 API]({FOOD_API})의 공식 페이지는 이용허락범위 제한 없음으로 표시한다. 이 조건을 원출처가 확정되지 않은 로컬 CSV의 이용조건으로 단정하지 않는다.',
        '- 건강검진·식품섭취 CSV는 원시자료에서 누가 어떤 열과 행을 추출했는지 이력이 필요하다. SAS 원본, 기존 프로필과 원본 해시를 별도로 보존했다.',
        '- 2024 영양조사 코드자료집은 새로 받은 XLSX와 기존 csv.zip 내부 파일의 SHA-256이 일치한다. 제9기 이용지침서 3개 사본도 해시가 같고 모두 보존했다.',
        '- 공식 건강정보 PDF 5개는 기존 검토의 공식 게시물·버전과 연결하고 현재 파일 해시를 다시 확인했다. 원문·이미지·표의 서비스 재사용 조건은 별도 확인 대상이다.',
        '- 식품성분표의 설명문에서 농촌진흥청 국가표준식품성분 DB 10.4(2026)와 공공누리 제1유형 출처표시 조건을 확인했다. 기본 식품·원재료 조회용이며, 현재 가공 상태는 아래 별도 항목에 기록했다. 표준수산식품 DB는 PDF 참고 자료로 보관한다.', '',
        '## 출처별 목록', '',
        '| ID | 자료·사용 목적 | 확인 수준 | 공식 관련 페이지 |',
        '| --- | --- | --- | --- |',
    ]
    labels = {
        'user_provided_bundle': '사용자 제공 묶음',
        'provider_or_format_checked_origin_unresolved': '제공기관/형식 확인 · 추출 경로 미확인',
        'user_reported_and_sas_metadata_checked': '사용자 전달·SAS 메타데이터 확인',
        'document_cover_and_selected_sections_checked': '표지·관련 부분 확인',
        'workbook_sheets_and_hash_checked': '시트·해시 확인',
        'official_document_identified_selected_sections_checked': '공식 문서 식별·관련 부분 검토',
        'official_workbook_description_identified': '엑셀 설명문에서 발행기관·판·기준량·표기 규칙 확인',
        'official_distribution_user_confirmed_content_review_pending': '공식 배포 출처 사용자 확인 · 전체 내용 점검 대기',
        'local_file_identified_origin_and_quality_pending': '파일·메타데이터 확인 · 출처/품질 대기',
        'official_distribution_and_license_identified': '공식 배포·라이선스 확인 · 본체 검증 대기 가능',
    }
    for s in payload['sources']:
        url = s['official_reference_urls'][0] if s['official_reference_urls'] else None
        ref = f'[공식 관련 페이지]({url})' if url else '미확인'
        lines.append(f"| {s['id']} | {s['title']} / {s['purpose']} | {labels[s['identity_status']]} | {ref} |")
    composition = next(s for s in payload['sources'] if s['id'] == 'RDA_COMPOSITION_XLSX')
    prepared = composition.get('processed_dataset')
    lines += ['', '## 식품성분표 10.4 전처리', '',
              (f"기본 식품 {prepared['rows']:,}건·핵심 영양소 {prepared['core_nutrient_count']}개의 CSV/JSONL과 원본 셀 보존본을 생성했다. 가공 파일 해시는 등록부 재생성 시 대조한다."
               if prepared else '가공본이 현재 로컬에 없다. 원본을 준비한 뒤 전처리 명령을 실행한다.'), '',
              '[처리 규칙·검증 결과·재현 방법](../FOOD_COMPOSITION.md). 기존 CSV 5만 행 가공본 및 식약처 엑셀과 별도 자료다. 다른 DB와 코드·이름만으로 자동 병합하지 않는다.', '']
    cgm = next(s for s in payload['sources'] if s['id'] == 'CGMACROS_1_0_0')
    lines += ['', '## CGMacros 다운로드 확인', '',
              '[공식 배포 페이지](https://physionet.org/content/cgmacros/1.0.0/) · [공개 체크섬](https://physionet.org/files/cgmacros/1.0.0/SHA256SUMS.txt)', '',
              '공식 페이지의 라이선스는 **CC-BY-NC-SA-4.0**으로 기록했다. 내려받은 `LICENSE.txt`는 0바이트지만 빈 파일의 해시 자체가 공식 체크섬과 일치하므로, 라이선스가 없다고 해석하지 않는다. 현재 기능의 필수 입력으로 채택하지 않았으며 다운로드는 중단·재시작하지 않았다.', '',
              '| 파일 | 상태 |', '| --- | --- |']
    for f in cgm['files']:
        status = {'matches_official_sha256': '공식 SHA-256 일치', 'download_incomplete_not_hashed': '다운로드 미완료 · 해시 검증 대기', 'not_downloaded': '아직 없음'}[f['hash_status']]
        lines.append(f"| {Path(f['path']).name} | {status} |")
    lines += ['', '다운로드 상태는 위 관찰 시각의 스냅샷이다. 나중에 아래 명령을 다시 실행하면 로컬 관찰과 해시 검증 상태를 갱신한다. 웹페이지의 조건·버전을 다시 확인하는 명령은 아니다.', '',
              '```powershell', 'python scripts/catalog_data_sources.py', '```', '',
              '## 보완할 출처 정보', '',
              '| 우선순위 | 필요한 정보 | 기록할 내용 |', '| --- | --- | --- |',
              '| 높음 | 보유한 공식 식품 엑셀 전처리 | 음식·가공식품 DB의 칼럼 대응, 기준량·단위, 결측, 중복 코드와 출처 보존 |',
              '| 보통 | 공식 엑셀의 파일별 배포 기록 | 상세 배포 URL·실제 입수일·버전·이용조건. 출처 사용자 확인은 기록 완료 |',
              '| 보통 | 국민건강영양조사 자료 입수 기록 | 해당 연도 상세 배포 페이지, 실제 입수일, 배포본 이용약관 |',
              '| 후속 | 기존 식품 CSV 전달 이력 | 상세 URL·추출 시점·필터·이용조건. 공식 엑셀 전처리를 위해 먼저 해결할 필요는 없음 |',
              '| 후속 | 수산식품 및 추가 성분 | 수산식품 PDF는 필요한 항목만 검토. 식품성분표의 핵심 7개 외 성분은 원본 셀 보존본에서 후속 정규화 |', '',
              '확인되지 않은 항목이 있어도 가상 시연 기록 생성과 조회·집계 검증용 사례 준비는 진행할 수 있다. 현재 정리에서는 원자료를 이동·삭제하거나 앱·원격 문서를 수정하지 않았다.', '',
              '논문과 문헌 서지는 [기존 문헌 등록부](references.json)에 유지했다. 이 등록부는 그 내용을 대체하지 않는다.', '']
    (OUT / 'DATA_SOURCES.md').write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    result = build()
    print(json.dumps({'sources': len(result['sources']), 'local_observed_at': result['local_observed_at'],
                      'outputs': ['docs/research/DATA_SOURCES.md', 'docs/research/data_sources.json']}, ensure_ascii=False))
