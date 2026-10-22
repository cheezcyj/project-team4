"""Build/check the replacement runtime corpus from reviewed draft documents; offline only."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'docs/research/chatbot_replacement_v1'
OUTPUT = FOLDER / 'knowledge.json'
KEYWORDS = {
    'B01': ['당화혈색소', '평균혈당', 'HbA1c'],
    'B02': ['식후2시간', '식후2h', '언제부터', '첫숟가락', '식사시작', '밥을다먹고'],
    'B03': ['측정상황', '메모', '왜기록', '날짜시간', '기록을남기'],
    'B04': ['몇번', '측정횟수', '하루몇', '측정계획'],
    'N01': ['당뇨식사', '식사원칙', '식사구성', '균형', '식품군', '식단예시'],
    'N02': ['탄수화물', '밥안먹', '곡류', '현미', '끊어', '완전제한'],
    'N03': ['무가당', '무당', '무설탕', '제로슈거', '영양표시', '영양정보', '당류', '기준량'],
    'N04': ['과일', '주스', '착즙', '식이섬유', '통과일'],
    'X01': ['걷기', '걷는', '걸어', '산책', '30분', '가벼운운동', '운동예시'],
    'X02': ['실내', '집안', '집에서', '벽밀기', '팔들기', '근력', '저항운동'],
    'X03': ['운동전후', '운동전', '운동후', '저혈당', '인슐린', '혈당확인', '혈당을확인'],
    'X04': ['운동시작', '운동시작전', '새운동', '새로운운동', '합병증', '발상태', '운동제한'],
    'X05': ['운동가능', '운동허가', '수치하나', '혈당수치', '운동해도', '결정할수'],
}
LOCATORS = {
    'B01': 'A1C 설명; 자가 혈당계가 보여 주는 현재 값',
    'B02': 'Recommended targets: 식사 시작 기준의 약 2시간',
    'B03': '자가 측정 결과의 날짜·시간·음식·활동 기록',
    'B04': '자가 혈당 측정 방법·빈도의 개별 계획',
    'N01': '개별 영양 상담; 4. 식품 기반 권고',
    'N02': '2.1 탄수화물; 2.2 식이섬유; 4.1 통곡물; 4.3 콩류',
    'N03': '별지 1, 1. 아. 1), 2)나)(3), 3)가)(2), 3)다)',
    'N04': '4.2 Gemüse und Obst: 통과일·주스·식이섬유',
    'X01': 'Aerobic activities: 걷기와 활동 나누기',
    'X02': 'Strength training or resistance training: 벽밀기·팔 들기',
    'X03': 'Stay safe during physical activity: 저혈당 위험',
    'X04': '신체활동 전 상담과 개인별 활동 계획',
    'X05': '개인별 활동 상담: 서비스 지원 범위의 배경 근거',
}


def content_hash(entry: dict) -> str:
    fields = ('version', 'topic', 'language', 'title', 'summary', 'keywords', 'evidence', 'conditions')
    raw = json.dumps({k: entry[k] for k in fields}, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def build() -> dict:
    registry_path = FOLDER / 'SOURCES.json'
    faq_path = FOLDER / 'FAQ_13.md'
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    text = faq_path.read_text(encoding='utf-8')
    matches = re.findall(r'^## ([BNX]\d{2})\. ([^\n]+)\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    assert len(matches) == 13 and {m[0] for m in matches} == set(KEYWORDS)
    map_by_id = {item['id']: item for item in registry['faq_map']}
    sources = []
    for original in registry['sources']:
        sid = original['id']
        if sid in ('R1', 'R2'):
            label, url = 'NIDDK 교육 본문 이용정책', original['reuse']['policy_url']
            attribution = f"NIDDK, {original['title']}. 원문 검토 2023년 10월."
        elif sid == 'R3':
            label, url = 'CC BY 4.0', original['reuse']['licence_url']
            attribution = 'Klammer C, Schindler K, Bugl R, et al. (2026), DOI: 10.1007/s00508-025-02676-7.'
        else:
            label, url = '국가 고시 규범 본문: 저작권법 제7조제2호', original['reuse']['policy_url']
            attribution = '식품의약품안전처, 식품등의 표시기준 제2025-60호(2025-08-29).'
        sources.append({
            'id': sid, 'title': original['title'], 'publisher': original['publisher'],
            'canonical_url': original['canonical_url'],
            'kind': 'open_health_reference' if sid == 'R3' else 'official_food_label_reference' if sid == 'R4' else 'official_health_reference',
            'document_type': 'notice' if sid == 'R4' else 'web',
            'status': 'pending_review', 'approved_at': None, 'permitted_runtime_reuse': None,
            'reuse_label': label, 'reuse_url': url, 'attribution': attribution,
            'adaptation_notice': '프로젝트가 일반 교육용으로 한국어 요약·재구성했습니다. 원문과 차이가 있으며, 원저자·기관의 서비스 승인을 뜻하지 않습니다.',
            'source_sha256': original['snapshot']['sha256'],
        })
    entries = []
    for eid, title, body in matches:
        summary = re.search(r'\*\*답변 문안(?: — 제품 제한)?:\*\* (.+)', body)
        assert summary, eid
        limits = re.search(r'\*\*제품 제한:\*\* (.+)', body)
        conditions = [limits[1]] if limits else ['개인 운동 허가는 서비스의 지원 범위 밖이며 기관의 지침 문장으로 인용하지 않는다.']
        if eid.startswith('X'):
            conditions += [
                '활동 예시는 일반 교육이다. 현재 증상·평소 활동 수준·복약·합병증·기존 제한에 따라 적합성이 달라진다는 조건을 유지한다.',
                '개인에게 시간·강도·거리·반복 횟수·소모 열량·약물 조정량을 정하지 않는다.',
            ]
        entry = {
            'id': eid, 'version': 1, 'topic': 'basic' if eid == 'B01' else 'measurement' if eid.startswith('B') else 'meal' if eid.startswith('N') else 'exercise',
            'language': 'ko-KR', 'title': title, 'summary': summary[1].strip(), 'keywords': KEYWORDS[eid],
            'evidence': [{'source_id': sid, 'section': LOCATORS[eid],
                          'role': 'background_only' if eid == 'X05' else 'label_basis' if eid == 'N03' else 'medical_basis'}
                         for sid in map_by_id[eid]['source_ids']],
            'conditions': conditions, 'status': 'draft', 'approved_at': None, 'review_due_at': None,
        }
        entry['content_sha256'] = content_hash(entry)
        entries.append(entry)
    return {
        'schema_version': '2.0', 'bundle_version': 'replacement-v1-draft-1', 'authored_on': '2026-10-22',
        'status': 'draft_connected_for_demo_preview',
        'approval': {'team_content_approved': False, 'medical_review_completed': False, 'source_reuse_review_completed': False},
        'policy': {'runtime_publishable': False}, 'sources': sources, 'knowledge_entries': entries,
        'provenance': {'builder': 'scripts/prepare_assistant_replacement.py', 'input_sha256': {
            p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (registry_path, faq_path)
        }},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify the committed/generated bundle without changing it.')
    args = parser.parse_args()
    expected = json.dumps(build(), ensure_ascii=False, indent=2) + '\n'
    if args.check:
        assert OUTPUT.read_text(encoding='utf-8') == expected, 'Replacement runtime corpus is stale; regenerate it.'
    else:
        OUTPUT.write_text(expected, encoding='utf-8')
    print('PASS: 13 entries, 4 replacement sources, content/provenance hashes, public approval remains false')


if __name__ == '__main__':
    main()
