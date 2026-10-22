"""Create deterministic, explicitly synthetic fixtures for the proposed diary.

This generates JSON fixtures and expected examples, not users in Supabase or
an application query implementation. No clinical or external records are read.
"""
import argparse
import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'fixtures/demo'
KST = timezone(timedelta(hours=9))
AS_OF = datetime(2026, 10, 21, 12, 0, tzinfo=KST)
START = date(2026, 10, 8)
END = AS_OF.date()


def identifier(key):
    return str(uuid5(NAMESPACE_URL, 'https://github.com/cheezcyj/project-team4/demo/' + key))


def when(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=KST)


def build():
    users = [{'id': identifier('user/' + key), 'demo_key': key,
              'display_name': name, 'is_synthetic': True}
             for key, name in [('a', '가상 사용자 A'), ('b', '가상 사용자 B')]]
    records = []

    def add(user, day, label, value, context, meal_period=None, memo=None,
            measured=None, created=None, updated=None, tags=None):
        measured = measured or when(day, 7, 30)
        created = created or measured + timedelta(minutes=2)
        record = {
            'id': identifier(f'record/{user}/{day.isoformat()}/{label}'),
            'user_id': users[0 if user == 'a' else 1]['id'],
            'glucose_mg_dl': value, 'glucose_unit': 'mg/dL',
            'measured_at': measured.astimezone(timezone.utc).isoformat(),
            'measurement_timezone': 'Asia/Seoul',
            'measurement_context': context, 'meal_period': meal_period,
            'meal_memo': memo, 'selected_foods': [],
            'created_at': created.astimezone(timezone.utc).isoformat(),
            'updated_at': (updated or created).astimezone(timezone.utc).isoformat(),
            'is_synthetic': True, 'scenario_tags': tags or [],
        }
        records.append(record)
        return record

    fasting = {8: 126, 9: 124, 10: 128, 11: 122, 12: 121, 13: 123,
               15: 127, 17: 119, 18: 116, 19: 118, 20: 120, 21: 110}
    for offset in range((END - START).days + 1):
        day = START + timedelta(days=offset)
        if day.day != 14:
            if day.day in fasting:
                add('a', day, 'fasting', fasting[day.day], 'fasting',
                    memo=None if day.day % 2 else '',
                    created=when(END, 10, 15) if day.day == 20 else None,
                    updated=when(END, 10, 20) if day.day == 20 else None,
                    tags=['late_entry', 'edited_at_after_measurement'] if day.day == 20 else [])
            if day.day != 17:
                add('a', day, 'breakfast-2h', 180 if day.day == 21 else 150 + offset * 2,
                    'after_meal_2h', 'breakfast',
                    memo=None if day.day == 12 else '아침 식사 후 기록(가상 메모)',
                    measured=when(day, 9, 40), tags=['missing_meal_memo'] if day.day == 12 else [])
            if day < END:
                if day.day in {11, 18}:
                    add('a', day, 'dinner-before', 132 + offset, 'before_meal', 'dinner',
                        measured=when(day, 18, 0), memo='저녁 식전 기록(가상 메모)')
                else:
                    add('a', day, 'dinner-2h', 160 + offset, 'after_meal_2h', 'dinner',
                        measured=when(day, 20, 10), memo='저녁 식사 후 기록(가상 메모)')
        add('b', day, 'fasting', 200 + offset, 'fasting')
        if day < END:
            add('b', day, 'breakfast-2h', 220 + offset, 'after_meal_2h', 'breakfast',
                measured=when(day, 9, 40), memo='다른 사용자 메모(가상)')

    # These rows intentionally exercise boundaries and possible duplicate saves.
    add('a', date(2026, 10, 10), 'fasting-possible-duplicate', 128, 'fasting',
        tags=['same_time_same_value_distinct_id'])
    add('a', date(2026, 10, 20), 'midnight', 138, 'other',
        measured=when(date(2026, 10, 20), 0, 10), tags=['kst_date_differs_from_utc_date'])
    add('a', END, 'midnight', 144, 'other', measured=when(END, 0, 5),
        tags=['kst_date_differs_from_utc_date'])
    add('a', date(2026, 10, 19), 'unknown-context', 147, 'other',
        measured=when(date(2026, 10, 19), 15, 0), tags=['comparison_context_unspecified'])
    records.sort(key=lambda r: (r['user_id'], r['measured_at'], r['id']))
    uid = users[0]['id']
    scenarios = [
        {'id': 'D01', 'question_id': 'R01', 'description': '같은 조건의 어제·오늘 공복 비교',
         'query': {'user_id': uid, 'days': ['2026-10-20', '2026-10-21'], 'context': 'fasting'},
         'expected': {'counts': [1, 1], 'means_mg_dl': [120, 110], 'delta_mg_dl': -10},
         'expected_answer': '어제 공복 1건 120, 오늘 공복 1건 110 mg/dL. 두 측정값의 차이는 -10 mg/dL. 오늘 기록은 현재까지이며 개선·원인을 단정하지 않음.'},
        {'id': 'D02', 'question_id': 'R01', 'description': '한쪽 날짜에 같은 조건의 기록이 없음',
         'query': {'user_id': uid, 'days': ['2026-10-15', '2026-10-16'], 'context': 'fasting'},
         'expected': {'counts': [1, 0], 'means_mg_dl': [127, None], 'delta_mg_dl': None},
         'expected_answer': '10월 16일 공복 기록이 없어 변화량 비교 보류. 기록이 없는 날을 0으로 채우지 않음.'},
        {'id': 'D03', 'question_id': 'R02', 'description': '오늘 포함 최근 7개 달력 날짜의 공복 기록',
         'query': {'user_id': uid, 'start_date': '2026-10-15', 'end_date': '2026-10-21', 'context': 'fasting'},
         'expected': {'record_count': 6, 'record_days': 6, 'mean_mg_dl_1dp': 118.3,
                      'missing_dates': ['2026-10-16']},
         'expected_answer': '최근 7개 날짜 중 6일·6건의 공복 기록 평균 118.3 mg/dL. 10월 16일 공복 기록 없음. 오늘은 현재까지 집계.'},
        {'id': 'D04', 'question_id': 'R01', 'description': '본인 데이터 범위를 유지하는 조회 사례',
         'query': {'user_id': uid, 'days': ['2026-10-20', '2026-10-21'], 'context': 'fasting'},
         'expected': {'allowed_user_id': uid, 'counts': [1, 1], 'means_mg_dl': [120, 110]},
         'expected_answer': '같은 날짜의 다른 사용자 기록을 결과나 설명에 포함하지 않음. 실제 접근 제어 검증은 앱에서 별도로 수행.'},
        {'id': 'D05', 'question_id': 'R03', 'description': '실제 측정 시각과 나중에 저장·수정한 시각 구분',
         'query': {'user_id': uid, 'date': '2026-10-20', 'context': 'fasting'},
         'expected': {'measured_date_kst': '2026-10-20', 'created_date_kst': '2026-10-21', 'glucose_mg_dl': 120},
         'expected_answer': '10월 21일 입력·수정했어도 10월 20일 공복 기록으로 분류. 수정 이력 전체가 있다고 표현하지 않음.'},
        {'id': 'D06', 'question_id': 'R03', 'description': 'UTC 저장 시각을 한국 날짜로 조회',
         'query': {'user_id': uid, 'date': '2026-10-21'},
         'expected': {'record_count': 3, 'midnight_value_mg_dl': 144,
                      'midnight_utc_date': '2026-10-20', 'midnight_kst_date': '2026-10-21'},
         'expected_answer': 'UTC 10월 20일 15:05의 기록은 한국 시각 10월 21일 00:05 기록으로 조회.'},
        {'id': 'D07', 'question_id': 'R03', 'description': '식사 메모·선택 음식이 없는 기록',
         'query': {'user_id': uid, 'date': '2026-10-12', 'context': 'after_meal_2h', 'meal_period': 'breakfast'},
         'expected': {'record_count': 1, 'meal_memo': None, 'selected_foods': []},
         'expected_answer': '메모 없음으로 안내. 음식·양·영양정보를 추측하지 않음.'},
        {'id': 'D08', 'question_id': 'R02', 'description': '같은 시각·수치라도 서로 다른 기록 ID가 존재하는 사례',
         'query': {'user_id': uid, 'date': '2026-10-10', 'context': 'fasting'},
         'expected': {'record_count': 2, 'distinct_record_ids': 2, 'value_mg_dl': 128},
         'expected_answer': '서로 다른 저장 기록 2건으로 표시하고 중복 의심 여부를 확인할 수 있게 함. 임의 삭제하지 않음.'},
        {'id': 'D09', 'question_id': 'R01', 'description': '식사 구분이 다른 식후 기록을 구분',
         'query': {'user_id': uid, 'date': '2026-10-20', 'context': 'after_meal_2h'},
         'expected': {'breakfast': [174], 'dinner': [172]},
         'expected_answer': '아침·저녁 식후 2시간 기록을 식사 구분별로 보존. 다른 식사의 값을 같은 조건으로 자동 합치지 않음.'},
        {'id': 'D10', 'question_id': 'R01', 'description': '해당 날짜에 혈당 기록 전체가 없음',
         'query': {'user_id': uid, 'date': '2026-10-14'},
         'expected': {'record_count': 0},
         'expected_answer': '기록 없음으로 안내하고 값을 보간·생성하거나 0으로 표시하지 않음.'},
    ]
    bundle = {'schema_version': '1.0', 'dataset_id': 'project-team4-synthetic-glucose-v1',
              'is_synthetic': True, 'purpose': '수동 기록·조회·최근 7일 그래프·챗봇 기록 요약의 개발 시연',
              'reference_as_of': AS_OF.isoformat(), 'date_range_kst': {'start': START.isoformat(), 'end': END.isoformat()},
              'source': '팀 프로젝트용 결정적 규칙으로 만든 가상 데이터. 임상·KNHANES·CGMacros 자료를 복제하거나 학습해 생성하지 않음.',
              'limitations': ['혈당값은 임상적 대표성·치료 효과·정상 범위의 근거가 아님.',
                              '가상 UUID는 실제 Auth 계정이 아님. 앱 연결 시 테스트 사용자 ID로 명시적으로 매핑해야 함.',
                              'measurement_context와 meal_period 코드는 개발용 초안. 팀 ERD 확정 후 매핑 필요.',
                              'created_at·updated_at은 예시 시각이며 전체 수정 이력을 제공하지 않음.',
                              '식사 시작 시각을 저장하지 않았으므로 식후 2시간 준수를 검증한 자료가 아님.',
                              'selected_foods는 모두 빈 배열. 식품코드·섭취량·영양 합계를 만들어 넣지 않음.'],
              'users': users, 'records': records}
    cases = {'schema_version': '1.0', 'is_synthetic': True, 'dataset_id': bundle['dataset_id'],
             'reference_as_of': AS_OF.isoformat(), 'scenarios': scenarios,
             'validation_scope': '생성한 가상 자료와 수작업 기대값의 일관성 확인. 앱·인증·DB 접근 제어·챗봇 실제 응답의 테스트 결과가 아님.'}
    return bundle, cases


def select(records, user_id, day=None, context=None, meal=None):
    return [r for r in records if r['user_id'] == user_id
            and (day is None or datetime.fromisoformat(r['measured_at']).astimezone(KST).date().isoformat() == day)
            and (context is None or r['measurement_context'] == context)
            and (meal is None or r['meal_period'] == meal)]


def validate(bundle, cases):
    rows = bundle['records']
    uid = bundle['users'][0]['id']
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate record IDs')
    known_users = {u['id'] for u in bundle['users']}
    assert len(known_users) == 2 and all(r['is_synthetic'] for r in rows)
    for r in rows:
        assert r['user_id'] in known_users
        assert isinstance(r['glucose_mg_dl'], int) and r['glucose_mg_dl'] > 0
        assert r['glucose_unit'] == 'mg/dL' and r['measurement_timezone'] == 'Asia/Seoul'
        measured, created, updated = [datetime.fromisoformat(r[k]) for k in ('measured_at', 'created_at', 'updated_at')]
        assert all(t.tzinfo is not None for t in (measured, created, updated))
        assert START <= measured.astimezone(KST).date() <= END
        assert measured <= created <= updated <= AS_OF
        assert r['selected_foods'] == []
    a = select(rows, uid, '2026-10-20', 'fasting')
    b = select(rows, uid, '2026-10-21', 'fasting')
    assert [r['glucose_mg_dl'] for r in a] == [120]
    assert [r['glucose_mg_dl'] for r in b] == [110]
    assert b[0]['glucose_mg_dl'] - a[0]['glucose_mg_dl'] == -10
    assert len(select(rows, uid, '2026-10-15', 'fasting')) == 1
    assert len(select(rows, uid, '2026-10-16', 'fasting')) == 0
    recent = [r for r in select(rows, uid, context='fasting')
              if date(2026, 10, 15) <= datetime.fromisoformat(r['measured_at']).astimezone(KST).date() <= END]
    assert len(recent) == 6
    assert sum(r['glucose_mg_dl'] for r in recent) == 710
    mean = (Decimal(710) / Decimal(6)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
    assert mean == Decimal('118.3')
    assert all(r['user_id'] == uid for r in a + b + recent)
    assert any(r['user_id'] != uid for r in rows)
    assert datetime.fromisoformat(a[0]['created_at']).astimezone(KST).date().isoformat() == '2026-10-21'
    today = select(rows, uid, '2026-10-21')
    assert len(today) == 3
    midnight = [r for r in today if r['glucose_mg_dl'] == 144][0]
    assert datetime.fromisoformat(midnight['measured_at']).date().isoformat() == '2026-10-20'
    missing_memo = select(rows, uid, '2026-10-12', 'after_meal_2h', 'breakfast')
    assert len(missing_memo) == 1 and missing_memo[0]['meal_memo'] is None
    possible_duplicates = select(rows, uid, '2026-10-10', 'fasting')
    assert len(possible_duplicates) == 2
    assert len({r['id'] for r in possible_duplicates}) == 2
    assert {r['glucose_mg_dl'] for r in possible_duplicates} == {128}
    assert [r['glucose_mg_dl'] for r in select(rows, uid, '2026-10-20', 'after_meal_2h', 'breakfast')] == [174]
    assert [r['glucose_mg_dl'] for r in select(rows, uid, '2026-10-20', 'after_meal_2h', 'dinner')] == [172]
    assert not select(rows, uid, '2026-10-14')
    assert len({c['id'] for c in cases['scenarios']}) == 10
    return {'result': 'PASS', 'records': len(rows), 'users': len(known_users), 'scenario_count': 10,
            'records_per_user': {u['demo_key']: len(select(rows, u['id'])) for u in bundle['users']},
            'validation_scope': cases['validation_scope']}


def write(out):
    bundle, cases = build()
    report = validate(bundle, cases)
    out.mkdir(parents=True, exist_ok=True)
    for filename, value in [('glucose_records.json', bundle), ('scenarios.json', cases)]:
        (out / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    manifest = {'dataset_id': bundle['dataset_id'], 'is_synthetic': True,
                'generator': 'scripts/prepare_demo_data.py', 'reference_as_of': AS_OF.isoformat(),
                'validation': report, 'files': []}
    for filename in ['glucose_records.json', 'scenarios.json']:
        content = (out / filename).read_bytes()
        manifest['files'].append({'name': filename, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    print(json.dumps(write(args.output_dir), ensure_ascii=False))
