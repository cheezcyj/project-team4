"""Prepare the supplied RDA 10.4 workbook without modifying the original.

Uses the Python standard library. Preserves all source cells separately and
exposes seven core nutrients with explicit missing/trace/provenance metadata.
"""
import argparse
import csv
import json
import math
import posixpath
import re
import sys
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from food_catalog import CatalogError, nutrition, search, search_key, sha256

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/식품성분표(10개정판).xlsx'
DEFAULT_DIR = ROOT / 'data/processed/food_composition_10_4'
EXAMPLES = ROOT / 'fixtures/food/composition_validation_examples.json'
SOURCE_ID = 'RDA_COMPOSITION_XLSX'
SHEET = '국가표준식품성분 Database 10.4'
CODE_SHEET = '부록1)식품코드 연계표'
TAG = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
CORE = {
    'energy_kcal': ('F', '에너지', 'kcal'),
    'protein_g': ('H', '단백질', 'g'),
    'fat_g': ('I', '지방', 'g'),
    'carbohydrate_g': ('K', '탄수화물', 'g'),
    'sugars_g': ('L', '당류', 'g'),
    'dietary_fiber_g': ('S', '총 식이섬유', 'g'),
    'sodium_mg': ('AA', '나트륨', 'mg'),
}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def read_workbook(source):
    """Resolve shared strings and worksheet relationships; keep numeric XML text."""
    with ZipFile(source) as z:
        strings = []
        with z.open('xl/sharedStrings.xml') as stream:
            for _, element in ET.iterparse(stream, events=['end']):
                if element.tag == TAG + 'si':
                    strings.append(''.join(t.text or '' for t in element.iter(TAG + 't')))
                    element.clear()
        relations = {r.attrib['Id']: r.attrib['Target']
                     for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall(TAG + 'sheets/' + TAG + 'sheet'):
            target = relations[sheet.attrib[REL + 'id']]
            sheets[sheet.attrib['name']] = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
        result = {}
        for name in [SHEET, CODE_SHEET]:
            if name not in sheets:
                raise CatalogError('missing_sheet', f'필요한 시트가 없습니다: {name}')
            rows = {}
            with z.open(sheets[name]) as stream:
                for _, element in ET.iterparse(stream, events=['end']):
                    if element.tag != TAG + 'row':
                        continue
                    cells = {}
                    for cell in element.findall(TAG + 'c'):
                        if cell.find(TAG + 'f') is not None or cell.attrib.get('t') == 'e':
                            raise CatalogError('unexpected_cell', f'수식·오류 셀은 검토가 필요합니다: {name}!{cell.attrib["r"]}')
                        value = cell.findtext(TAG + 'v')
                        if cell.attrib.get('t') == 's' and value is not None:
                            value = strings[int(value)]
                        elif cell.attrib.get('t') == 'inlineStr':
                            value = ''.join(t.text or '' for t in cell.iter(TAG + 't'))
                        if value is not None:
                            cells[re.sub(r'\d+', '', cell.attrib['r'])] = value
                    if cells:
                        rows[int(element.attrib['r'])] = cells
                    element.clear()
            result[name] = rows
    return result


def extract_tables(workbook):
    table, links = workbook[SHEET], workbook[CODE_SHEET]
    if table[1].get('D') != '가식부 100g 당 (per 100g Edible Portion)':
        raise CatalogError('basis_changed', '가식부 100g 기준을 확인해야 합니다.')
    for key, (column, label, unit) in CORE.items():
        if search_key(table[2].get(column, '')) != search_key(label) or table[3].get(column) != unit:
            raise CatalogError('header_changed', f'성분 머리글·단위가 다릅니다: {key}')
    if links[3].get('A') != 'DB 10.4' or [links[4].get(c) for c in ['A', 'B', 'C']] != ['색인', '식품코드', '식품명']:
        raise CatalogError('mapping_header_changed', '10.4판 코드 연계표를 확인해야 합니다.')
    mapping = {}
    for number, cells in links.items():
        if number < 5:
            continue
        index, code, name = (cells.get(c) for c in ['A', 'B', 'C'])
        if not index or not index.isdigit() or not code or not name or index in mapping:
            raise CatalogError('invalid_mapping', f'코드 연계표의 누락·중복: {number}')
        mapping[index] = {'code': code, 'name': name, 'row': number}
    data, used_codes, used_indexes = [], set(), set()
    for number, cells in table.items():
        if number < 4:
            continue
        index = cells.get('A')
        link = mapping.get(index)
        if not index or not index.isdigit() or index in used_indexes or not link or cells.get('D') != link['name']:
            raise CatalogError('mapping_mismatch', f'행·색인·식품명 연결 불일치: {number}')
        if link['code'] in used_codes:
            raise CatalogError('duplicate_food_code', f'중복 식품코드는 삭제하지 않고 중단합니다: {link["code"]}')
        used_codes.add(link['code'])
        used_indexes.add(index)
        data.append((number, cells, link))
    if used_indexes != set(mapping):
        raise CatalogError('unused_mapping', '성분표와 코드 연계표의 식품 범위가 다릅니다.')
    return data


def parse_nutrient(raw, source_cell):
    text = '' if raw is None else raw.strip()
    referenced = text.startswith('(') and text.endswith(')')
    inner = text[1:-1].strip() if referenced else text
    metadata = {'raw': raw, 'status': 'numeric',
                'qualifier': 'referenced_or_calculated' if referenced else None,
                'source_cell': source_cell}
    if inner in {'', '-', 'Tr'}:
        metadata['status'] = {'': 'blank', '-': 'unmeasured', 'Tr': 'trace'}[inner]
        return None, metadata
    if not re.fullmatch(r'\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?', inner):
        raise CatalogError('unknown_nutrient_marker', f'검토가 필요한 영양값: {source_cell} = {raw!r}')
    # XLSX numeric cells store doubles. Keep the exact XML text in metadata;
    # converting to float removes binary serialization tails, without rounding.
    value = float(inner)
    if not math.isfinite(value) or value < 0:
        raise CatalogError('invalid_nutrient', f'유한한 음이 아닌 영양값이 필요합니다: {source_cell}')
    return int(value) if value.is_integer() else value, metadata


def prepare(source, output_dir):
    before = sha256(source)
    registry = json.loads((ROOT / 'docs/research/data_sources.json').read_text(encoding='utf-8'))
    registered = next(s for s in registry['sources'] if s['id'] == SOURCE_ID)
    if registered['files'][0]['sha256'] != before:
        raise CatalogError('source_changed', '등록부와 다른 식품성분표입니다. 출처·판을 먼저 점검해야 합니다.')
    workbook = read_workbook(source)
    table = extract_tables(workbook)
    rows, originals = [], []
    for number, cells, link in table:
        record = {
            'food_code': link['code'], 'food_name': cells['D'], 'food_type': '국가표준식품성분',
            'food_group': cells.get('C'), 'nutrient_basis_raw': '100g', 'basis_amount': 100,
            'basis_unit': 'g', 'basis_note': workbook[SHEET][1]['D'], 'edible_portion_only': True,
            'food_weight_raw': None, 'provider': '농촌진흥청', 'reference_source': cells.get('E'),
            'search_key': search_key(cells['D']), 'source_id': SOURCE_ID, 'source_version': '10.4',
            'source_index': cells['A'], 'book_index': cells.get('B'),
            'source_file': registered['files'][0]['path'], 'source_sheet': SHEET,
            'source_row': number, 'source_record_number': number,
            'code_mapping_sheet': CODE_SHEET, 'code_mapping_row': link['row'],
        }
        metadata = {}
        for key, (column, _, _) in CORE.items():
            record[key], metadata[key] = parse_nutrient(cells.get(column), f'{column}{number}')
        record['nutrient_metadata'] = metadata
        rows.append(record)
        originals.append({'source_sheet': SHEET, 'source_row': number, 'food_code': link['code'],
                          'cells': cells, 'code_mapping_sheet': CODE_SHEET,
                          'code_mapping_row': link['row'],
                          'code_mapping_cells': workbook[CODE_SHEET][link['row']]})
    if sha256(source) != before:
        raise CatalogError('source_changed', '읽는 동안 원본이 변경되었습니다.')
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, values in [('foods.jsonl', rows), ('source_rows.jsonl', originals)]:
        with (output_dir / filename).open('w', encoding='utf-8', newline='\n') as stream:
            for row in values:
                stream.write(json.dumps(row, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    csv_fields = ['food_code', 'food_name', 'food_group', 'basis_amount', 'basis_unit',
                  *CORE, *[key + '_' + suffix for key in CORE for suffix in ['status', 'qualifier', 'raw']],
                  'reference_source', 'source_id', 'source_sheet', 'source_row', 'code_mapping_row']
    with (output_dir / 'foods.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=csv_fields)
        writer.writeheader()
        for row in rows:
            flat = {key: row[key] for key in csv_fields if key in row}
            for key in CORE:
                flat.update({key + '_' + suffix: row['nutrient_metadata'][key][suffix]
                             for suffix in ['status', 'qualifier', 'raw']})
            writer.writerow(flat)
    profiles = {}
    for key in CORE:
        profiles[key] = {
            'status_counts': dict(Counter(r['nutrient_metadata'][key]['status'] for r in rows)),
            'referenced_or_calculated_count': sum(r['nutrient_metadata'][key]['qualifier'] is not None for r in rows),
            'numeric_zero_count': sum(r[key] == 0 for r in rows),
        }
    manifest = {
        'schema_version': '1.0', 'catalog_id': 'rda-10.4-' + before[:16],
        'source': {'id': SOURCE_ID, 'path': registered['files'][0]['path'], 'sha256': before,
                   'publisher': '농촌진흥청', 'version': '10.4', 'year_in_description': 2026,
                   'data_sheet': SHEET, 'code_mapping_sheet': CODE_SHEET,
                   'description_locator': 'DB 설명 시트의 설명문 이미지',
                   'license_label_in_description': '공공누리 제1유형: 출처표시',
                   'required_attribution': '농촌진흥청, 2026. 국가표준식품성분 DB 10.4. https://koreanfood.rda.go.kr',
                   'original_download_url': registered['original_download_url'], 'acquired_at': registered['acquired_at']},
        'selection': '10.4판만 사용. 10.0~10.3 및 신규·교체·삭제 목록을 음식 데이터로 합치지 않음.',
        'profile': {'rows': len(rows), 'unique_food_codes': len(rows),
                    'unique_food_names': len({r['food_name'] for r in rows}),
                    'basis': {'amount': 100, 'unit': 'g', 'edible_portion_only': True},
                    'food_group_counts': dict(Counter(r['food_group'] for r in rows)), 'nutrients': profiles},
        'core_columns': {key: {'column': col, 'label': label, 'unit': unit} for key, (col, label, unit) in CORE.items()},
        'files': [{'name': name, 'bytes': (output_dir / name).stat().st_size, 'sha256': sha256(output_dir / name)}
                  for name in ['foods.jsonl', 'foods.csv', 'source_rows.jsonl']],
        'rules': {
            'numeric': 'Excel의 숫자값을 보존. XML의 원문은 nutrient_metadata.raw와 source_rows에 별도 보존.',
            'unmeasured': '-는 null. 미측정을 0으로 채우지 않음.',
            'trace': 'Tr 및 (Tr)는 null+trace. 0으로 단정하거나 임의의 작은 수를 넣지 않음.',
            'referenced_or_calculated': '괄호 속 숫자는 계산 가능한 수치와 referenced_or_calculated 표시를 함께 보존.',
            'portion': '가식부 g만 환산. ml·개수·껍질 포함 무게로 자동 변환하지 않음.',
            'codes': '부록1의 10.4 색인·식품명으로 검증한 내부 연결. 다른 기관·조사 DB와의 코드 대응은 검증하지 않음.',
            'full_source': 'source_rows.jsonl에 10.4판 데이터 행의 모든 원본 셀과 연계표 행을 보존. 7개 외 성분은 정규화하지 않음.',
        },
        'generator': 'scripts/prepare_food_composition.py prepare',
        'runtime_scope': '개발용 데이터·검색·환산 참고 코드. 앱·DB·챗봇 연결 및 영양성분의 외부 정확성 검증은 별도.',
    }
    write_json(output_dir / 'manifest.json', manifest)
    return {'result': 'prepared', 'rows': len(rows), 'catalog_id': manifest['catalog_id'], 'output_dir': str(output_dir)}


def load(output_dir):
    manifest = json.loads((output_dir / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['schema_version'] != '1.0' or manifest['source']['id'] != SOURCE_ID:
        raise CatalogError('schema_mismatch', 'RDA 10.4 가공본이 아닙니다.')
    for info in manifest['files']:
        if sha256(output_dir / info['name']) != info['sha256']:
            raise CatalogError('output_hash_mismatch', f'가공 파일이 변경되었습니다: {info["name"]}')
    rows = [json.loads(line) for line in (output_dir / 'foods.jsonl').read_text(encoding='utf-8').splitlines()]
    return rows, manifest


def lookup(rows, food_code, amount=None, unit=None):
    result = nutrition(rows, food_code, amount, unit)
    row = next(r for r in rows if r['food_code'] == food_code)
    result['unavailable_numeric_nutrients'] = result.pop('missing_nutrients')
    result.update(nutrient_metadata=row['nutrient_metadata'],
                  nutrient_metadata_basis='source_reference_100g',
                  trace_nutrients=[key for key, meta in row['nutrient_metadata'].items() if meta['status'] == 'trace'],
                  unmeasured_nutrients=[key for key, meta in row['nutrient_metadata'].items() if meta['status'] == 'unmeasured'],
                  edible_portion_only=True, source_sheet=SHEET, source_row=row['source_row'],
                  source_version='10.4', reference_source=row['reference_source'])
    return result


def validate(source, output_dir, examples):
    rows, manifest = load(output_dir)
    if sha256(source) != manifest['source']['sha256']:
        raise CatalogError('source_changed', '원본 해시가 가공 시점과 다릅니다.')
    workbook = read_workbook(source)
    table = extract_tables(workbook)
    originals = [json.loads(line) for line in (output_dir / 'source_rows.jsonl').read_text(encoding='utf-8').splitlines()]
    if len(table) != len(rows) or len(originals) != len(rows) or len({r['food_code'] for r in rows}) != len(rows):
        raise CatalogError('row_mismatch', '가공본 행 수·식품코드가 다릅니다.')
    # Compare to original cells independently of the normalizer.
    for (number, cells, link), row, original in zip(table, rows, originals):
        assert row['food_code'] == link['code'] and row['food_name'] == cells['D']
        assert row['source_row'] == number and row['code_mapping_row'] == link['row']
        assert row['source_index'] == cells['A'] and row['reference_source'] == cells.get('E')
        assert row['food_group'] == cells.get('C') and row['book_index'] == cells.get('B')
        assert row['basis_amount'] == 100 and row['basis_unit'] == 'g' and row['edible_portion_only'] is True
        assert original['cells'] == cells and original['source_row'] == number
        assert original['food_code'] == link['code'] and original['code_mapping_row'] == link['row']
        assert original['code_mapping_cells'] == workbook[CODE_SHEET][link['row']]
        assert [original['code_mapping_cells'][c] for c in ['A', 'B', 'C']] == [cells['A'], link['code'], cells['D']]
        for key, (column, _, _) in CORE.items():
            raw = cells.get(column)
            text = '' if raw is None else raw.strip()
            parenthesized = text.startswith('(') and text.endswith(')')
            inner = text[1:-1].strip() if parenthesized else text
            meta = row['nutrient_metadata'][key]
            assert meta['raw'] == raw and meta['source_cell'] == f'{column}{number}'
            assert meta['qualifier'] == ('referenced_or_calculated' if parenthesized else None)
            if inner in {'', '-', 'Tr'}:
                assert row[key] is None and meta['status'] == {'': 'blank', '-': 'unmeasured', 'Tr': 'trace'}[inner]
            else:
                assert row[key] == float(inner) and meta['status'] == 'numeric'
    with (output_dir / 'foods.csv').open(encoding='utf-8-sig', newline='') as stream:
        csv_rows = list(csv.DictReader(stream))
    assert len(csv_rows) == len(rows)
    for csv_row, row in zip(csv_rows, rows):
        assert csv_row['food_code'] == row['food_code'] and csv_row['food_name'] == row['food_name']
        for key in CORE:
            assert csv_row[key] == ('' if row[key] is None else str(row[key]))
            assert csv_row[key + '_status'] == row['nutrient_metadata'][key]['status']
            assert csv_row[key + '_qualifier'] == (row['nutrient_metadata'][key]['qualifier'] or '')
            assert csv_row[key + '_raw'] == (row['nutrient_metadata'][key]['raw'] or '')
    cases = json.loads(examples.read_text(encoding='utf-8'))['cases']
    results, samples = [], []
    for case in cases:
        try:
            actual = search(rows, **case['input']) if case['operation'] == 'search' else lookup(rows, **case['input'])
        except CatalogError as error:
            assert error.code == case.get('expected_error'), (case['id'], error.code)
            actual = {'error': error.code, 'message': str(error)}
        else:
            assert 'expected_error' not in case, case['id']
            for path, expected in case.get('expected', {}).items():
                actual_value = actual
                for part in path.split('.'):
                    actual_value = actual_value[int(part)] if isinstance(actual_value, list) else actual_value[part]
                assert actual_value == expected, (case['id'], path, actual_value, expected)
        results.append({'id': case['id'], 'result': 'PASS'})
        samples.append({'id': case['id'], 'input': case['input'], 'response': actual})
    report = {'result': 'PASS', 'catalog_id': manifest['catalog_id'], 'source_rows_compared': len(rows),
              'nutrient_cells_compared': len(rows) * len(CORE), 'code_mapping_matches': len(rows),
              'csv_rows_compared': len(csv_rows), 'case_count': len(results), 'cases': results,
              'scope': '원본·내부 코드 연결·CSV/JSONL 일치·검색·표시 보존·동일 단위 환산의 로컬 검사. 앱·의학적 정확성 검증은 아님.'}
    write_json(output_dir / 'validation_report.json', report)
    write_json(output_dir / 'sample_responses.json', {'catalog_id': manifest['catalog_id'], 'samples': samples})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--data-dir', type=Path, default=DEFAULT_DIR)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    check = sub.add_parser('validate')
    check.add_argument('--examples', type=Path, default=EXAMPLES)
    query = sub.add_parser('search')
    query.add_argument('query')
    query.add_argument('--limit', type=int, default=10)
    query.add_argument('--offset', type=int, default=0)
    get = sub.add_parser('nutrition')
    get.add_argument('food_code')
    get.add_argument('--amount')
    get.add_argument('--unit')
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            result = prepare(args.source, args.data_dir)
        elif args.command == 'validate':
            result = validate(args.source, args.data_dir, args.examples)
        else:
            rows, manifest = load(args.data_dir)
            result = search(rows, args.query, args.limit, args.offset) if args.command == 'search' else lookup(rows, args.food_code, args.amount, args.unit)
            result['catalog_id'] = manifest['catalog_id']
    except (CatalogError, OSError) as error:
        print(json.dumps({'error': getattr(error, 'code', 'file_error'), 'message': str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
