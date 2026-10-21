"""Validate the authored v5 draft and render review documents; no AI or DB calls."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE = ROOT / 'docs/research/chatbot_v5/knowledge.json'
HASH_FIELDS = ('version', 'topic', 'language', 'title', 'summary', 'keywords', 'evidence', 'conditions')


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def entry_hash(entry: dict) -> str:
    content = {key: entry[key] for key in HASH_FIELDS}
    payload = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def validate(bundle: dict, verify_local: bool) -> list[str]:
    """Check the bundle as one functional unit, including optional original-file checks."""
    checks = []
    expected = {'sources': 8, 'knowledge_entries': 15, 'faqs': 20, 'meal_examples': 3, 'exercise_examples': 3}
    for section, count in expected.items():
        items = bundle[section]
        check(len(items) == count, f'{section}: expected {count}')
        check(len({item['id'] for item in items}) == count, f'{section}: duplicate IDs')
    checks.append('counts_and_unique_ids')
    source_map = {s['id']: s for s in bundle['sources']}
    entry_map = {e['id']: e for e in bundle['knowledge_entries']}
    example_ids = {e['id'] for name in ('meal_examples', 'exercise_examples') for e in bundle[name]}
    check(len({s['canonical_url'] for s in bundle['sources']}) == 8, 'duplicate canonical URLs')
    check(all(s['canonical_url'].startswith('https://') for s in bundle['sources']), 'source URL missing')
    for group in ('knowledge_entries', 'faqs', 'meal_examples', 'exercise_examples'):
        for item in bundle[group]:
            check(item['status'] == 'draft', f"not a draft: {item['id']}")
            for evidence in item['evidence']:
                source = source_map[evidence['source_id']]
                check(bool(evidence['section']), 'evidence locator missing')
                for page in evidence.get('pdf_pages', []):
                    check(type(page) is int and 1 <= page <= source['pdf_page_count'], 'PDF page out of range')
                if source['kind'] == 'product_specification':
                    check(evidence['role'] == 'product_rule', 'spec used as medical evidence')
            for key in item.get('knowledge_ids', []):
                check(key in entry_map, f'unknown knowledge ID: {key}')
            for key in item.get('example_ids', []):
                check(key in example_ids, f'unknown example ID: {key}')
            check(bool(item.get('evidence') or item.get('knowledge_ids')), 'missing provenance')
    checks.append('references_and_pdf_page_ranges')
    for entry in bundle['knowledge_entries']:
        check(bool(entry['summary'] and entry['keywords'] and entry['conditions']), 'empty knowledge content')
        check(entry_hash(entry) == entry['content_sha256'], f"content hash mismatch: {entry['id']}")
        check(entry['approved_at'] is None and entry['review_due_at'] is None, 'draft approval dates invented')
    checks.append('knowledge_content_hashes_and_draft_dates')
    categories = Counter(f['category'] for f in bundle['faqs'])
    check(categories == {'basic': 1, 'measurement': 4, 'meal': 5, 'exercise': 5, 'personal_records': 5}, 'FAQ coverage changed')
    for faq in bundle['faqs']:
        check(bool(faq['answer_template'] and faq['fallback'] and faq['conditions']), 'incomplete FAQ')
        placeholders = set(re.findall(r'\{([a-z_]+)\}', faq['answer_template']))
        check(placeholders == set(faq.get('output_fields', [])), f"template fields mismatch: {faq['id']}")
        if faq.get('operation') in ('compare_yesterday_today_same_context', 'summarize_recent_7_calendar_days_fasting'):
            check('personal_records 선택 동의' in faq['required_inputs'], 'personal data consent missing')
    checks.append('faq_coverage_templates_and_fallbacks')
    nutrient_keys = {'energy_kcal', 'protein_g', 'fat_g', 'carbohydrate_g', 'sugars_g', 'dietary_fiber_g', 'sodium_mg'}
    for meal in bundle['meal_examples']:
        check(meal['kind'] == 'team_assembled_food_group_illustration', 'unverified official menu attribution')
        check(meal['total_nutrition'] is None and meal['portion_prescription'] is None and meal['expected_glucose_change'] is None,
              'invented menu totals or prescription')
        check(bool(meal['target'] and meal['cautions'] and meal['known_allergen_ingredients']), 'incomplete meal card')
        for food in meal['ingredients']:
            check(food['amount_g'] is None, 'unapproved portion prescription')
            check(food['basis_amount'] == 100 and food['basis_unit'] == 'g' and food['edible_portion_only'], 'food basis mismatch')
            check(set(food['reference_nutrients_per_100g']) == nutrient_keys == set(food['nutrient_metadata']), 'nutrient fields missing')
            for nutrient, meta in food['nutrient_metadata'].items():
                value = food['reference_nutrients_per_100g'][nutrient]
                check(meta['status'] in ('numeric', 'unmeasured', 'trace', 'blank'), 'unknown nutrient status')
                if meta['status'] == 'numeric':
                    check(type(value) in (int, float), 'numeric nutrient missing')
                else:
                    check(value is None, 'missing or trace nutrient replaced by numeric value')
    for exercise in bundle['exercise_examples']:
        check(bool(exercise['target'] and exercise['guide'] and exercise['cautions']), 'incomplete exercise card')
        for key in ('duration_minutes', 'intensity_prescription', 'repetitions', 'calories_burned'):
            check(exercise[key] is None, f'prescription unexpectedly set: {key}')
    check(not any(bundle['approval'].values()), 'draft marked approved or integrated')
    check(bundle['policy']['runtime_publishable'] is False, 'draft published')
    check(bundle['record_contract']['fields'] == ['glucose_mg_dl', 'measured_at', 'measurement_context', 'meal_memo'], 'unsupported record fields')
    checks.append('example_boundaries_and_record_contract')
    if verify_local:
        for source in bundle['sources']:
            path = ROOT / source['local_path']
            check(path.is_file() and sha256(path) == source['sha256'], f"source missing or changed: {source['id']}")
        checks.append('all_8_source_file_sha256_matches')
        rda = source_map['RDA_COMPOSITION_XLSX']
        catalog_path = ROOT / rda['catalog_path']
        check(sha256(catalog_path) == rda['catalog_sha256'], 'RDA catalog hash changed')
        catalog = {f['food_code']: f for f in map(json.loads, catalog_path.read_text(encoding='utf-8').splitlines())}
        for meal in bundle['meal_examples']:
            for food in meal['ingredients']:
                original = catalog[food['food_code']]
                for key in ('food_name', 'basis_amount', 'basis_unit', 'basis_note', 'edible_portion_only', 'source_row', 'source_sheet', 'nutrient_metadata'):
                    check(food[key] == original[key], f"RDA source mismatch: {food['food_code']} {key}")
                check(food['reference_nutrients_per_100g'] == {k: original[k] for k in nutrient_keys}, 'RDA nutrient mismatch')
        checks.append('rda_catalog_hash_food_codes_nutrients_and_markers_match')
    return checks


def evidence_lines(item: dict, bundle: dict) -> list[str]:
    sources = {s['id']: s for s in bundle['sources']}
    evidence = list(item['evidence'])
    for key in item.get('knowledge_ids', []):
        evidence.extend(next(e for e in bundle['knowledge_entries'] if e['id'] == key)['evidence'])
    result = []
    for ev in evidence:
        source = sources[ev['source_id']]
        locator = ev['section']
        if ev.get('pdf_pages'):
            locator += ' · PDF ' + ', '.join(map(str, ev['pdf_pages'])) + '페이지'
        if ev.get('printed_pages'):
            locator += ' · 책자 ' + ', '.join(map(str, ev['printed_pages'])) + '쪽'
        label = '제품 규칙' if ev['role'] == 'product_rule' else '영양 참조' if ev['role'] == 'structured_reference' else '건강정보 근거'
        line = f"- [{source['title']}]({source['canonical_url']}) — {locator} ({label})"
        if line not in result:
            result.append(line)
    return result


def render_faq(bundle: dict) -> str:
    lines = ['# 챗봇 FAQ 20개 — v5 준비 초안', '',
        '[준비본 안내](README.md) · [구조화 JSON](knowledge.json) · [식단·운동 카드](EXAMPLES.md)', '',
        '일반 지식 5개·식사 5개·운동 5개·개인 기록과 이용 규칙 5개입니다. 의료·사용권 검토, 팀 승인, 실제 응답 평가는 아직 완료하지 않았습니다.', '',
        '개인 기록 답변의 `{...}`는 코드가 조회·계산한 결과를 넣는 자리입니다. 실제 혈당값이나 가상 사용자 값을 넣지 않았습니다. 일반 질문은 내 기록 조회 없이 답할 수 있습니다.', '',
        '| ID | 질문 |', '| --- | --- |']
    lines += [f"| {f['id']} | {f['question']} |" for f in bundle['faqs']]
    for faq in bundle['faqs']:
        lines += ['', f"## {faq['id']}. {faq['question']}", '', '**답변 초안**', '', faq['answer_template'], '', '**조건과 한계**', '']
        lines += ['- ' + s for s in faq['conditions']]
        if faq['required_inputs']:
            lines += ['', '**필요한 입력:** ' + ' / '.join(faq['required_inputs'])]
        if faq['example_ids']:
            lines += ['', '**연결할 예시:** ' + ', '.join(faq['example_ids']) + ' — [카드 문안](EXAMPLES.md)']
        if faq.get('operation'):
            lines += ['', '**구현용 동작:** `' + faq['operation'] + '` (아직 실행 함수가 아님)']
        lines += ['', '**정보가 없거나 범위를 벗어나면:** ' + faq['fallback'], '', '**근거**', '']
        lines += evidence_lines(faq, bundle)
    return '\n'.join(lines) + '\n'


def render_examples(bundle: dict) -> str:
    lines = ['# 식단 예시 3개·운동 안내 3개', '', '[준비본 안내](README.md) · [FAQ 20개](FAQ_20.md) · [JSON](knowledge.json)', '',
        '화면이나 보드에 옮길 수 있는 카드 문안입니다. 교육용 초안이며 개인별 처방이 아닙니다. 공식 자료에서 확인한 원칙과, 그 원칙을 바탕으로 작성한 조합을 구분했습니다.', '',
        '## 식단 카드 공통 안내', '',
        '세 식단은 곡류·단백질 식품·채소를 조합한 참고 예시입니다. 공식 기관의 완성 식단이나 영양적으로 완전한 한 끼를 재현한 것이 아닙니다. 개인에게 맞는 분량은 정하지 않았고, 조리유·양념을 포함한 한 끼 열량과 영양 합계도 계산하지 않았습니다. 알레르기, 동반질환, 복약 및 기존 식사 계획에 따라 조정이 필요합니다.', '']
    for meal in bundle['meal_examples']:
        lines += [f"### {meal['id']}. {meal['title']}", '', meal['description'], '', '**대상:** ' + meal['target'], '', '**주의할 점**', '']
        lines += ['- ' + s for s in meal['cautions'][:1]]
        lines += ['- 주요 알레르기 원재료: ' + ', '.join(meal['known_allergen_ingredients']) + '. ' + meal['allergen_note'], '', '**자료 링크**', '']
        lines += evidence_lines({'evidence': meal['evidence']}, bundle)
        lines += ['', '<details>', '<summary>개발용 식품 코드 연결</summary>', '',
            '아래 음식의 **가식부 100g** 기준 자료에 연결했습니다. 100g을 먹으라는 권고가 아닙니다. 재료별 7개 성분·미측정·미량·인용/환산 표시는 JSON에 보존했습니다.', '',
            '| 식품코드 | DB의 정확한 식품명 | 원본 행 |', '| --- | --- | --- |']
        lines += [f"| `{f['food_code']}` | {f['food_name']} | {f['source_row']} |" for f in meal['ingredients']]
        lines += ['', '</details>', '']
    lines += ['농촌진흥청, 2026. 국가표준식품성분 DB 10.4. <https://koreanfood.rda.go.kr>', '',
        '## 운동 카드 공통 안내', '',
        '아래는 공식 자료에 나온 활동 종류의 예시입니다. 시간이 30분 있다는 이유로 30분 수행을 지정하지 않습니다. 개인의 현재 증상·약물·합병증·기존 제한을 확인해야 하며, 시간·강도·횟수·소모 칼로리나 약물 조정량을 여기서 정하지 않습니다.', '']
    for exercise in bundle['exercise_examples']:
        lines += [f"### {exercise['id']}. {exercise['title']}", '', exercise['description'], '', '**대상:** ' + exercise['target'], '', '**안내 문안**', '']
        lines += [f'{i}. {s}' for i, s in enumerate(exercise['guide'], 1)]
        lines += ['', '**주의할 점**', ''] + ['- ' + s for s in exercise['cautions']]
        lines += ['', '**자료 링크**', ''] + evidence_lines({'evidence': exercise['evidence']}, bundle) + ['']
    lines += ['## 반영 전 확인할 사항', '',
        '- 출처의 이용조건과 요약 내용, 대상·주의 문구를 검토한 뒤 승인합니다.',
        '- 응급 의심 상황은 이 카드로 운동을 권하지 않고 도움 안내가 우선되도록 구현·검증해야 합니다.',
        '- 현재 파일 작성은 앱 화면 반영이나 실제 챗봇 출력 검증을 뜻하지 않습니다.', '']
    return '\n'.join(lines)


def render_sources(bundle: dict) -> str:
    lines = ['# 이 준비본에서 사용한 출처', '', '[준비본 안내](README.md) · [JSON](knowledge.json)', '',
        '건강정보 PDF 4개, 식품성분 자료 1개, 제품 규칙 문서 3개입니다. 제품 문서는 의학적 근거로 쓰지 않습니다. PDF 뷰어 페이지와 책자 쪽수를 구분합니다. 원본 파일 해시는 JSON에 기록했습니다.', '',
        '식품 자료 외 건강정보의 재사용 허용 범위는 이 준비본에서 승인하지 않았습니다. 열람·근거 대조와 서비스 재사용 승인은 별개입니다. 게시일·웹 수정일·브라우저 인쇄일을 같은 날짜로 취급하지 않습니다.', '']
    for source in bundle['sources']:
        lines += [f"## {source['id']}", '', f"[{source['title']}]({source['canonical_url']}) · {source['publisher']}", '',
            f"- 용도: `{source['kind']}`", f"- 원본/검토 스냅샷: `{source['local_path']}`", f"- SHA-256: `{source['sha256']}`"]
        if source.get('source_dates'):
            lines += ['- 원문 날짜 정보: `' + json.dumps(source['source_dates'], ensure_ascii=False) + '`']
        if source.get('license_label'):
            lines += ['- 확인한 이용조건: ' + source['license_label'] + ' (' + source.get('license_evidence', '') + ')']
        if source.get('required_attribution'):
            lines += ['- 출처표시: ' + source['required_attribution']]
        if source.get('reuse_note'):
            lines += ['- 상태: ' + source['reuse_note']]
        lines += ['']
    lines += ['## 이번 답변 자료로 사용하지 않은 데이터', '',
        '국민건강영양조사·PhysioNet·집단 통계 자료를 앱 이용자의 기록으로 쓰지 않았습니다. 기존 출처 미확정 CSV와 아직 전처리하지 않은 식약처 대용량 엑셀을 이 예시의 영양 수치 근거로 섞지 않았습니다. 기존 자료는 그대로 보존했습니다.', '']
    return '\n'.join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument('--write', action='store_true', help='render Markdown files beside the bundle')
    parser.add_argument('--verify-local', action='store_true', help='also verify local original hashes and the RDA catalog')
    parser.add_argument('--report', type=Path, help='write validation evidence to this JSON path')
    args = parser.parse_args()
    bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
    checks = validate(bundle, args.verify_local)
    outputs = {'FAQ_20.md': render_faq(bundle), 'EXAMPLES.md': render_examples(bundle), 'SOURCES.md': render_sources(bundle)}
    for name, content in outputs.items():
        path = args.bundle.parent / name
        if args.write:
            path.write_text(content, encoding='utf-8', newline='\n')
        else:
            check(path.is_file() and path.read_text(encoding='utf-8') == content, f'generated document out of sync: {name}')
    checks.append('generated_documents_match_canonical_bundle')
    report = dict(status='passed', scope='structure_provenance_and_local_consistency_not_medical_or_runtime_approval',
        bundle_version=bundle['bundle_version'], bundle_sha256=sha256(args.bundle),
        local_sources_verified=args.verify_local, checks=checks,
        counts={name: len(bundle[name]) for name in ('sources', 'knowledge_entries', 'faqs', 'meal_examples', 'exercise_examples')},
        generated_document_sha256={name: sha256(args.bundle.parent/name) for name in outputs},
        not_tested=['clinical accuracy approval', 'source reuse approval', 'real AI responses', 'app access control and consent', 'CSV import'])
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
