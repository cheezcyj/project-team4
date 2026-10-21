"""Prepare and query the local food CSV as typed JSONL for development.

No external API, database, LLM, or additional Python package is required.
The original archive stays intact. Source units and missing values are kept.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / 'data/processed/foods'
ARCHIVE_MEMBER = '식품영양성분_핵심컬럼.csv'
SCHEMA_VERSION = '1.0'
NUTRIENTS = {
    'energy_kcal': ('에너지(kcal)', 'kcal'),
    'protein_g': ('단백질(g)', 'g'),
    'fat_g': ('지방(g)', 'g'),
    'carbohydrate_g': ('탄수화물(g)', 'g'),
    'sugars_g': ('당류(g)', 'g'),
    'dietary_fiber_g': ('식이섬유(g)', 'g'),
    'sodium_mg': ('나트륨(mg)', 'mg'),
}
FIELDS = {
    'food_code': ('식품코드', 'string', '원본 식품코드. 이름이 같아도 코드가 다르면 별도 항목'),
    'food_name': ('식품명', 'string', '원본 표시 이름'),
    'food_type': ('데이터구분명', 'string', '원본 음식/가공식품 구분'),
    'nutrient_basis_raw': ('영양성분함량기준량', 'string', '원본 기준량 표기'),
    'basis_amount': ('영양성분함량기준량', 'number', '기준량 숫자'),
    'basis_unit': ('영양성분함량기준량', 'string', 'g 또는 ml. 차원을 임의 변환하지 않음'),
    **{key: (column, 'number|null', f'{unit} 단위 영양성분. 결측은 null, 실제 0은 0')
       for key, (column, unit) in NUTRIENTS.items()},
    'food_weight_raw': ('식품중량', 'string|null', '원본 문자열 보존. 검증된 1인분으로 해석하지 않음'),
    'provider': ('제공기관명', 'string', '원본 제공기관명'),
    'search_key': (None, 'string', 'NFKC·소문자화 후 공백·밑줄을 제거한 검색 전용 이름'),
    'source_id': (None, 'string', '출처 등록부의 FOOD_CSV'),
    'source_record_number': (None, 'integer', '헤더=1로 본 CSV 레코드 순번. 첫 데이터는 2'),
}


class CatalogError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def search_key(text):
    return re.sub(r'[\s_]+', '', unicodedata.normalize('NFKC', text).casefold())


def decimal_value(value):
    if isinstance(value, bool):
        raise CatalogError('invalid_number', '숫자를 입력해야 합니다.')
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise CatalogError('invalid_number', '올바른 숫자를 입력해야 합니다.') from exc
    if not result.is_finite():
        raise CatalogError('invalid_number', '유한한 숫자를 입력해야 합니다.')
    return result


def json_number(value):
    """Keep source decimal values exactly representable in the JSON spelling."""
    if value == value.to_integral_value():
        return int(value)
    number = float(value)
    if Decimal(str(number)) != value:
        raise CatalogError('numeric_precision_loss', '원본 수치의 정밀도를 보존할 수 없습니다.')
    return number


def normalize(row, record_number):
    match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(g|ml)', row['영양성분함량기준량'], re.IGNORECASE)
    if not match:
        raise CatalogError('unknown_basis', '알 수 없는 원본 기준량입니다.')
    basis = decimal_value(match.group(1))
    if basis <= 0:
        raise CatalogError('invalid_basis', '원본 기준량은 양수여야 합니다.')
    record = {
        'food_code': row['식품코드'], 'food_name': row['식품명'],
        'food_type': row['데이터구분명'], 'nutrient_basis_raw': row['영양성분함량기준량'],
        'basis_amount': json_number(basis), 'basis_unit': match.group(2).lower(),
    }
    if not record['food_code'] or not record['food_name']:
        raise CatalogError('missing_identity', '식품코드와 이름이 필요합니다.')
    for key, (column, _) in NUTRIENTS.items():
        raw = row[column].strip()
        value = decimal_value(raw) if raw else None
        if value is not None and value < 0:
            raise CatalogError('negative_nutrient', f'음수 영양성분: {record["food_code"]} / {column}')
        record[key] = None if value is None else json_number(value)
    record.update(food_weight_raw=row['식품중량'] if row['식품중량'].strip() else None,
                  provider=row['제공기관명'], search_key=search_key(row['식품명']),
                  source_id='FOOD_CSV', source_record_number=record_number)
    return record


def read_original(archive):
    with ZipFile(archive) as z:
        with z.open(ARCHIVE_MEMBER) as source:
            reader = csv.DictReader(io.TextIOWrapper(source, encoding='utf-8-sig', newline=''))
            rows = list(reader)
            columns = reader.fieldnames
        with z.open(ARCHIVE_MEMBER) as stream:
            member_hash = hashlib.sha256(stream.read()).hexdigest()
    if any(None in row or any(v is None for v in row.values()) for row in rows):
        raise CatalogError('malformed_csv', '원본 CSV의 행 구조를 확인해야 합니다.')
    return rows, columns, member_hash


def prepare(archive, output_dir):
    profile = json.loads((ROOT / 'docs/data_profile.json').read_text(encoding='utf-8'))
    expected = profile['csv_profiles'][ARCHIVE_MEMBER]
    archive_hash = sha256(archive)
    if archive_hash != profile['archive_sha256']:
        raise CatalogError('source_changed', '기존 점검과 다른 ZIP입니다. 출처·프로필을 먼저 갱신해야 합니다.')
    original, columns, member_hash = read_original(archive)
    if columns != expected['columns'] or len(original) != expected['rows']:
        raise CatalogError('profile_mismatch', '원본 행·칼럼 구성이 기존 프로필과 다릅니다.')
    catalog = [normalize(row, n) for n, row in enumerate(original, start=2)]
    if len({r['food_code'] for r in catalog}) != len(catalog):
        raise CatalogError('duplicate_food_code', '중복 식품코드가 있어 임의로 삭제하지 않고 중단합니다.')
    names = Counter(r['food_name'] for r in catalog)
    source = next(s for s in json.loads((ROOT / 'docs/research/data_sources.json').read_text(encoding='utf-8'))['sources']
                  if s['id'] == 'FOOD_CSV')
    if source['files'][0]['sha256'] != member_hash:
        raise CatalogError('source_registry_mismatch', '출처 등록부의 CSV 해시와 다릅니다.')
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / 'foods.jsonl'
    with output_path.open('w', encoding='utf-8', newline='\n') as stream:
        for row in catalog:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    manifest = {
        'schema_version': SCHEMA_VERSION, 'catalog_id': 'food-csv-' + member_hash[:16],
        'purpose': '텍스트 음식 검색·기준량 영양정보·동일 단위 환산의 개발용 자료',
        'source': {'id': 'FOOD_CSV', 'archive': 'data/csv.zip', 'archive_sha256': archive_hash,
                   'archive_member': ARCHIVE_MEMBER, 'member_sha256': member_hash,
                   'publisher_column_value': '식품의약품안전처', 'source_registry': 'docs/research/data_sources.json',
                   'original_download_url': source['original_download_url'], 'acquired_at': source['acquired_at'],
                   'identity_status': source['identity_status'], 'license': source['license']},
        'files': [{'name': 'foods.jsonl', 'bytes': output_path.stat().st_size, 'sha256': sha256(output_path)}],
        'schema': [{'name': key, 'source_column': value[0], 'type': value[1], 'description': value[2]}
                   for key, value in FIELDS.items()],
        'profile': {'rows': len(catalog), 'unique_food_codes': len(catalog), 'unique_food_names': len(names),
                    'names_with_multiple_codes': sum(count > 1 for count in names.values()),
                    'basis_counts': dict(Counter(r['nutrient_basis_raw'] for r in catalog)),
                    'food_type_counts': dict(Counter(r['food_type'] for r in catalog)),
                    'food_weight_null_count': sum(r['food_weight_raw'] is None for r in catalog),
                    'null_counts': {key: sum(r[key] is None for r in catalog) for key in NUTRIENTS},
                    'zero_counts': {key: sum(r[key] == 0 for r in catalog) for key in NUTRIENTS}},
        'coverage_checks': [{'query': query, 'exact_name_matches': sum(r['search_key'] == search_key(query) for r in catalog),
                             'substring_matches': sum(search_key(query) in r['search_key'] for r in catalog)}
                            for query in ['흑미밥', '김치찌개', '우유', '바나나']],
        'rules': ['식품코드·원본 이름·기준량·식품중량·제공기관·원본 순서를 보존',
                  '숫자 빈칸은 null, 실제 0은 0. 임의 채움·삭제·다른 DB 조인 없음',
                  '식품중량을 1인분·밀도·실제 섭취량으로 간주하지 않음',
                  '섭취량이 없으면 기준량만 조회. g와 ml는 밀도 없이 변환하지 않음',
                  '명칭이 같아도 코드를 선택해야 조회. 자동으로 한 항목을 선택하지 않음'],
        'review_notes': [
            {'food_code': 'D501-052000000-0001', 'issue': '흑미밥의 원본 기준량이 100ml로 되어 있음. 원자료 대조가 필요하며 100g으로 임의 수정하지 않음.'},
            {'issue': '우유·바나나라는 정확한 이름은 현재 추출본에 없음. 부분 문자열 후보를 요청 음식과 동일하다고 단정하지 않음.'},
            {'issue': '현재 5만 행 추출본이며 전체 최신 식품 DB를 대표한다고 볼 수 없음.'},
        ],
        'generator': 'scripts/food_catalog.py prepare',
    }
    (output_dir / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'result': 'prepared', 'rows': len(catalog), 'catalog_id': manifest['catalog_id'],
            'names_with_multiple_codes': manifest['profile']['names_with_multiple_codes'],
            'outputs': [str(output_path), str(output_dir / 'manifest.json')]}


def load(output_dir):
    manifest = json.loads((output_dir / 'manifest.json').read_text(encoding='utf-8'))
    rows = [json.loads(line) for line in (output_dir / 'foods.jsonl').read_text(encoding='utf-8').splitlines() if line]
    if manifest['schema_version'] != SCHEMA_VERSION:
        raise CatalogError('schema_mismatch', '지원하지 않는 데이터 스키마입니다.')
    return rows, manifest


def search(rows, query, limit=10, offset=0):
    needle = search_key(query)
    if not needle:
        raise CatalogError('query_required', '검색어를 입력해야 합니다.')
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
        raise CatalogError('invalid_limit', '결과 수는 1~50의 정수여야 합니다.')
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise CatalogError('invalid_offset', '시작 위치는 0 이상의 정수여야 합니다.')
    matches = [r for r in rows if needle in r['search_key']]
    def rank(r):
        key = r['search_key']
        return (0 if key == needle else 1 if key.startswith(needle) else 2, key, r['food_code'])
    matches.sort(key=rank)
    candidates = []
    for r in matches[offset:offset + limit]:
        kind = 'exact_name' if r['search_key'] == needle else 'prefix' if r['search_key'].startswith(needle) else 'substring'
        candidates.append({key: r[key] for key in ['food_code', 'food_name', 'food_type', 'nutrient_basis_raw', 'provider']} | {'match_kind': kind})
    return {'query': query, 'total_matches': len(matches),
            'exact_name_matches': sum(r['search_key'] == needle for r in matches),
            'requires_food_code_selection': bool(matches), 'offset': offset, 'limit': limit,
            'returned_count': len(candidates),
            'has_more': offset + len(candidates) < len(matches), 'candidates': candidates}


def nutrition(rows, food_code, amount=None, unit=None):
    row = next((r for r in rows if r['food_code'] == food_code), None)
    if row is None:
        raise CatalogError('food_not_found', '해당 식품코드가 없습니다.')
    if amount is None and unit is not None:
        raise CatalogError('amount_required', '양과 단위를 함께 입력해야 합니다.')
    if amount is not None and unit is None:
        raise CatalogError('unit_required', '양과 단위를 함께 입력해야 합니다.')
    quantity = decimal_value(row['basis_amount'])
    output_unit = row['basis_unit']
    if amount is not None:
        quantity = decimal_value(amount)
        if quantity <= 0:
            raise CatalogError('invalid_amount', '양은 0보다 커야 합니다.')
        output_unit = unit.strip().lower()
        if output_unit not in {'g', 'ml'}:
            raise CatalogError('unsupported_unit', '현재 g와 ml만 지원합니다.')
        if output_unit != row['basis_unit']:
            raise CatalogError('unit_mismatch', '원본 기준량과 입력량의 단위가 다릅니다. 밀도 없이 g와 ml를 변환하지 않습니다.')
    factor = quantity / decimal_value(row['basis_amount'])
    values = {key: row[key] for key in NUTRIENTS} if amount is None else {
        key: None if row[key] is None else
        json_number((decimal_value(row[key]) * factor).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
        for key in NUTRIENTS}
    return {'food_code': row['food_code'], 'food_name': row['food_name'], 'food_type': row['food_type'],
            'reference_basis': {'amount': row['basis_amount'], 'unit': row['basis_unit'], 'raw': row['nutrient_basis_raw']},
            'calculation_basis': 'reference' if amount is None else 'specified_amount',
            'quantity': {'amount': json_number(quantity), 'unit': output_unit},
            'nutrients': values, 'missing_nutrients': [key for key in NUTRIENTS if row[key] is None],
            'provider': row['provider'], 'source_id': row['source_id'],
            'source_record_number': row['source_record_number'],
            'rounding': '원본값 유지' if amount is None else '환산 결과는 소수 둘째 자리까지 반올림(ROUND_HALF_UP). 원본 데이터 수치는 유지.'}


def validate(archive, output_dir, example_path):
    rows, manifest = load(output_dir)
    if sha256(archive) != manifest['source']['archive_sha256']:
        raise CatalogError('source_changed', '출처 ZIP 해시가 다릅니다.')
    original, _, member_hash = read_original(archive)
    if member_hash != manifest['source']['member_sha256']:
        raise CatalogError('member_hash_mismatch', '원본 CSV 해시가 다릅니다.')
    file_info = manifest['files'][0]
    if sha256(output_dir / file_info['name']) != file_info['sha256']:
        raise CatalogError('output_hash_mismatch', '가공 데이터 해시가 다릅니다.')
    if len(rows) != len(original) or len({r['food_code'] for r in rows}) != len(rows):
        raise CatalogError('row_identity_mismatch', '행 수·식품코드 일관성을 확인해야 합니다.')
    # Independently compare values and identity against the original CSV.
    for position, (raw, typed) in enumerate(zip(original, rows), start=2):
        for key, column in [('food_code', '식품코드'), ('food_name', '식품명'), ('food_type', '데이터구분명'),
                            ('nutrient_basis_raw', '영양성분함량기준량'), ('provider', '제공기관명')]:
            if typed[key] != raw[column]:
                raise CatalogError('source_value_changed', f'원본 문자열 불일치: {position} / {key}')
        if typed['source_record_number'] != position or typed['food_weight_raw'] != (raw['식품중량'] or None):
            raise CatalogError('source_position_changed', '원본 위치·식품중량이 다릅니다.')
        basis = f"{typed['basis_amount']}{typed['basis_unit']}"
        if basis != raw['영양성분함량기준량']:
            raise CatalogError('basis_changed', '기준량 숫자·단위를 확인해야 합니다.')
        for key, (column, _) in NUTRIENTS.items():
            if not raw[column].strip():
                if typed[key] is not None:
                    raise CatalogError('missing_value_filled', '결측이 임의로 채워졌습니다.')
            elif typed[key] is None or Decimal(str(typed[key])) != Decimal(raw[column]):
                raise CatalogError('nutrient_changed', f'영양성분이 변경되었습니다: {position} / {key}')
    examples = json.loads(example_path.read_text(encoding='utf-8'))
    results = []
    samples = []
    for case in examples['cases']:
        try:
            actual = search(rows, **case['input']) if case['operation'] == 'search' else nutrition(rows, **case['input'])
        except CatalogError as error:
            if error.code != case.get('expected_error'):
                raise
            samples.append({'id': case['id'], 'operation': case['operation'], 'input': case['input'],
                            'response': {'error': error.code, 'message': str(error)}})
        else:
            if case.get('expected_error'):
                raise AssertionError(f"Expected an error: {case['id']}")
            for path, value in case.get('expected', {}).items():
                item = actual
                for part in path.split('.'):
                    item = item[int(part)] if isinstance(item, list) else item[part]
                if item != value:
                    raise AssertionError(f"{case['id']}: {path} expected {value!r}, got {item!r}")
            samples.append({'id': case['id'], 'operation': case['operation'], 'input': case['input'], 'response': actual})
        results.append({'id': case['id'], 'result': 'PASS'})
    report = {'result': 'PASS', 'catalog_id': manifest['catalog_id'], 'source_rows_compared': len(rows),
              'nutrient_fields_compared_per_row': len(NUTRIENTS), 'case_count': len(results), 'cases': results,
              'scope': '원본 보존·검색·기준량 조회·동일 단위 산술의 로컬 참고 코드 검사. 앱 UI·DB·챗봇·원자료 영양성분의 외부 정확성 검증은 아님.'}
    (output_dir / 'validation_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output_dir / 'sample_responses.json').write_text(json.dumps({'catalog_id': manifest['catalog_id'], 'samples': samples}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=DEFAULT_DIR)
    parser.add_argument('--archive', type=Path, default=ROOT / 'data/csv.zip')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    verify = sub.add_parser('validate')
    verify.add_argument('--examples', type=Path, default=ROOT / 'fixtures/food/validation_examples.json')
    query = sub.add_parser('search')
    query.add_argument('query')
    query.add_argument('--limit', type=int, default=10)
    query.add_argument('--offset', type=int, default=0)
    lookup = sub.add_parser('nutrition')
    lookup.add_argument('food_code')
    lookup.add_argument('--amount')
    lookup.add_argument('--unit')
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            result = prepare(args.archive, args.data_dir)
        elif args.command == 'validate':
            result = validate(args.archive, args.data_dir, args.examples)
        else:
            rows, manifest = load(args.data_dir)
            result = search(rows, args.query, args.limit, args.offset) if args.command == 'search' else nutrition(rows, args.food_code, args.amount, args.unit)
            result['catalog_id'] = manifest['catalog_id']
    except (CatalogError, OSError) as error:
        print(json.dumps({'error': getattr(error, 'code', 'file_error'), 'message': str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
