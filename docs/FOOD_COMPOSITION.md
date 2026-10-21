# 식품성분표 10.4 전처리 결과

처리일: 2026-10-21. [식품성분표 원본](<../data/식품성분표(10개정판).xlsx>)의 **10.4판 3,366건**을 코드 연계표와 연결해 CSV·JSONL로 가공했다. 10.0~10.3판과 신규·교체·삭제 목록은 합치지 않았다. 원본과 기존 CSV 5만 행 가공본은 보존했다.

## 결과 파일

저장 위치: `data/processed/food_composition_10_4/`

| 파일 | 내용 |
| --- | --- |
| [foods.csv](../data/processed/food_composition_10_4/foods.csv) | UTF-8 BOM. 식품코드·이름·분류, 기준량, 핵심 영양소 7개, 성분별 상태·인용/환산 여부·원문, 원본 위치 |
| [foods.jsonl](../data/processed/food_composition_10_4/foods.jsonl) | 식품 1개당 JSON 객체 1개. 숫자·null·표기 정보와 출처를 함께 보관 |
| [source_rows.jsonl](../data/processed/food_composition_10_4/source_rows.jsonl) | 10.4판 식품 행의 모든 원본 셀과 부록1의 대응 행. 핵심 7개 외 성분도 원문 보존 |
| [manifest.json](../data/processed/food_composition_10_4/manifest.json) | 원본·가공본 SHA-256, 칼럼 대응, 품질 집계, 처리 규칙과 출처표시 문구 |
| [validation_report.json](../data/processed/food_composition_10_4/validation_report.json) | 원본 전수 대조·코드 연결·CSV 일치·기능 검증 결과 |
| [sample_responses.json](../data/processed/food_composition_10_4/sample_responses.json) | 검색·조회·환산·정보 부족·오류 처리의 실제 로컬 응답 |

`data/`는 Git에서 제외되어 있다. 팀원은 동일 원본과 출처 등록부를 준비하고 아래 명령으로 재생성한다. [처리 코드](../scripts/prepare_food_composition.py)와 [검증 기대값](../fixtures/food/composition_validation_examples.json)은 별도 보관한다.

## 선택·연결·표기 규칙

- 사용 시트는 `국가표준식품성분 Database 10.4`다. 성분표의 색인을 `부록1)식품코드 연계표`의 **10.4판 색인**과 연결하고, 식품명까지 같은지 전수 대조했다. 책자 색인과 혼동하지 않는다.
- 식품코드 3,366개·식품명 3,366개 모두 고유하다. 연결 실패·중복 코드는 임의로 삭제하거나 첫 번째 값으로 고르지 않고 처리를 중단한다.
- **모든 영양값은 가식부 100g 기준이다. 우유도 이 파일에서는 100g 기준이다.** 가식부는 껍질 등 먹지 않는 부분을 제외한 양이다. 폐기율로 섭취량을 자동 추정하지 않는다.
- 실제 숫자 0은 0으로 둔다. `-`는 미측정으로 `null + unmeasured`, `Tr`은 미량으로 `null + trace`를 보관한다. 둘을 0으로 채우거나 같은 상태로 합치지 않는다.
- `(0.3)`처럼 괄호 속 숫자는 수치 0.3과 `referenced_or_calculated` 표시를 함께 보존한다. `(Tr)`은 `trace`와 같은 표시를 함께 보존한다. 표기되지 않은 숫자도 모두 직접 측정값이라고 단정하지 않는다.
- 원본 XML의 `9.8800000000000008` 같은 숫자는 Excel의 부동소수점 값 9.88로 읽으며 임의 자릿수 반올림은 하지 않는다. XML 원문은 성분별 `raw`와 `source_rows.jsonl`에 보존한다.
- 식품명·자료의 원출처 표기(`농진청('20)`, `USDA('18)` 등)·원본 시트/행·코드 연계표 행을 유지한다. 조회용 이름만 NFKC·소문자화 후 공백·밑줄을 제거한다.

## 핵심 필드와 품질

| 필드 | 원본 열 | 단위 | 숫자값 | 미측정 | 미량 |
| --- | --- | --- | ---: | ---: | ---: |
| `energy_kcal` | F: 에너지 | kcal | 3,366 | 0 | 0 |
| `protein_g` | H: 단백질 | g | 3,365 | 1 | 0 |
| `fat_g` | I: 지방 | g | 3,348 | 11 | 7 |
| `carbohydrate_g` | K: 탄수화물 | g | 3,345 | 9 | 12 |
| `sugars_g` | L: 당류 | g | 2,197 | 1,169 | 0 |
| `dietary_fiber_g` | S: 총 식이섬유 | g | 2,509 | 855 | 2 |
| `sodium_mg` | AA: 나트륨 | mg | 2,921 | 434 | 11 |

숫자값에는 괄호 속 숫자도 포함된다. 인용·환산 표시는 별도 축이므로 이 표의 건수에 더하지 않는다. 해당 표시 건수는 manifest에 있다. CSV에서 숫자 칸이 비어 있으면 해당 성분의 `_status`와 `_qualifier` 열을 함께 확인한다.

`nutrient_metadata`에는 성분별 `raw`, `status`, `qualifier`, `source_cell`을 보관한다. `source_id=RDA_COMPOSITION_XLSX`, `source_version=10.4`, `source_index`, `source_row`, `code_mapping_row`로 원문을 찾을 수 있다. 여러 DB를 함께 사용할 때는 출처·버전·식품코드를 함께 저장한다. 이번 코드 연결은 **이 엑셀 내부의 성분표와 부록 사이**에서만 검증했으며 식약처·국민건강영양조사 코드 대응은 별도다.

## 생성·검증·조회

Python 3.10 이상, 추가 패키지 없이 프로젝트 루트에서 실행한다.

```powershell
python -X utf8 scripts/prepare_food_composition.py prepare
python -X utf8 scripts/prepare_food_composition.py validate
python -X utf8 scripts/prepare_food_composition.py search "바나나" --limit 5
python -X utf8 scripts/prepare_food_composition.py nutrition H0370000000a
python -X utf8 scripts/prepare_food_composition.py nutrition H0370000000a --amount 150 --unit g
```

양을 입력하지 않으면 기준량 정보를 반환한다. 양이 있으면 **가식부 g끼리만** 환산하며, 결과만 소수 둘째 자리 `ROUND_HALF_UP`으로 반올림한다. 숫자값이 없는 성분은 환산 후에도 null과 표기 상태를 유지한다. 응답의 `nutrient_metadata`는 항상 원본 100g 기준의 표기 정보이며, `nutrients`가 입력량 기준의 계산 결과다.

예: `바나나, 생것`은 원본 100g당 77kcal·탄수화물 20g이고, 가식부 150g이면 115.5kcal·30g이다. 우유에 200ml를 입력하면 밀도 정보가 없으므로 단위 불일치로 안내한다. 이는 영양정보 산술이며 섭취량 권고가 아니다.

다른 출력 폴더를 지정할 때는 공통 인수를 하위 명령 앞에 둔다.

```powershell
python -X utf8 scripts/prepare_food_composition.py --data-dir .tmp/research/composition-reproduction prepare
python -X utf8 scripts/prepare_food_composition.py --data-dir .tmp/research/composition-reproduction validate
```

## 검증 범위와 출처

3,366행·23,562개 핵심 성분 셀을 원본과 대조하고, 코드 연결 3,366건·CSV 행 3,366건을 확인했다. 생바나나·백미밥·우유·오트밀·미음·과당의 실제 값과 표기, 섭취량 환산, 단위 불일치, 미검색, 잘못된 입력 등 **18개 사례를 통과**했다. 원자료 영양값의 외부 정확성이나 앱·DB·챗봇 연결을 검증한 것은 아니다.

별도 폴더에서 다시 생성·검증한 결과, 위 결과 파일 6개가 바이트 단위로 일치했다. 원본 엑셀과 기존 CSV 가공본 4개의 해시도 작업 전후 동일했다.

엑셀의 `DB 설명` 시트에 포함된 설명문 이미지에서 발행기관·2026년·10.4판·가식부 기준·표기 규칙을 확인했다. 설명문은 공공누리 제1유형 출처표시 조건과 다음 표기 예를 안내한다.

> 농촌진흥청, 2026. 국가표준식품성분 DB 10.4. https://koreanfood.rda.go.kr

파일별 실제 입수일·정확한 다운로드 상세 URL은 미확인으로 유지한다. [출처 등록부](research/DATA_SOURCES.md)의 `RDA_COMPOSITION_XLSX`에 확인 근거와 가공본을 연결했다. 식약처 음식·가공식품 엑셀의 전처리와 두 출처를 함께 조회하는 앱 구현은 후속 작업이다.
