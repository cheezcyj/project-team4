# 국민건강영양조사 SAS 파일 읽기

2026-10-20 로컬 파일 확인 기준입니다. SAS 프로그램 없이 Python의 `pyreadstat`로 읽을 수 있습니다. 실제 데이터는 pandas DataFrame, 한글 변수 설명 등은 별도 메타데이터로 반환됩니다.

## 로컬 구성

`data`는 데이터 프로젝트에서 일반적으로 쓰는 이름이므로 유지했습니다. 다운로드한 ZIP은 그대로 보존하고, 압축을 푼 SAS 원본과 생성된 변수 목록을 하위 폴더에 구분했습니다.

```text
data/
  csv.zip
  HN22_ALL(SAS).zip          # 다운로드 원본 ZIP 6개는 기존 위치 유지
  ...
  raw/knhanes/
    2022/hn22_all.sas7bdat
    2022/hn22_24rc.sas7bdat
    2023/hn23_all.sas7bdat
    2023/hn23_24rc.sas7bdat
    2024/hn24_all.sas7bdat
    2024/hn24_24rc.sas7bdat
  metadata/knhanes/
    inventory.json         # 행·변수 수, 인코딩, 원본/추출 파일 SHA-256
    hn24_all_columns.csv   # 변수명, 한글 설명, 자료형, SAS 형식
    hn24_24rc_columns.csv  # 연도별 총 6개 변수 목록
    ...
```

압축 해제한 SAS 파일의 총 크기는 약 2.35 GiB입니다. 로컬 원자료와 생성 파일인 `data/`는 Git 추적 대상에서 제외했습니다. `.venv`는 데이터 확인용 Python 환경이며 웹앱 실행 환경과 별개입니다.

| 연도 | 통합자료 `ALL` 행 × 변수 | 식품섭취자료 `24RC` 행 × 변수 |
| --- | ---: | ---: |
| 2022 | 6,265 × 700 | 447,623 × 110 |
| 2023 | 6,929 × 647 | 531,581 × 112 |
| 2024 | 6,997 × 813 | 543,782 × 110 |

6개 파일 모두 메타데이터를 읽었으며 인코딩은 `EUC-KR`로 인식됐습니다. 2024년 두 파일에서 선택한 변수의 실제 행도 정상적으로 읽었습니다. 행 수는 SAS 메타데이터에 기록된 값입니다.

## 바로 실행

프로젝트 루트에서 PowerShell로 실행합니다. 현재 PC에는 아래 환경 설치와 압축 해제가 완료되어 있습니다.

```powershell
.\.venv\Scripts\python.exe -X utf8 scripts/read_sas_example.py
```

예제는 건강 지표 7개 변수를 전체 6,997행에서 읽고, 식품섭취자료는 6개 변수·처음 100행만 읽습니다. 파일이나 CSV를 새로 저장하지 않습니다.

다른 PC에서 다시 준비할 때는 다음을 실행합니다. `uv`가 설치되어 있다는 전제이며, 별도 Python 환경이 있다면 `python -m pip install -r requirements-data.txt`로 패키지를 설치해도 됩니다.

```powershell
uv venv --python 3.13 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements-data.txt
.\.venv\Scripts\python.exe -X utf8 scripts/prepare_sas.py
```

준비 스크립트는 ZIP 원본을 수정하지 않습니다. 기존 추출 파일이 있으면 크기와 CRC가 ZIP과 같은지 확인하고 재사용하며, 다르면 덮어쓰지 않고 중단합니다.

## 직접 읽기

VS Code에서 인터프리터를 `.venv\Scripts\python.exe`로 선택하고 다음처럼 작성합니다. 상대경로는 프로젝트 루트 기준입니다.

```python
import pyreadstat

df, meta = pyreadstat.read_sas7bdat(
    "data/raw/knhanes/2024/hn24_all.sas7bdat",
    usecols=["ID", "age", "HE_glu", "HE_HbA1c"],
)

print(df.head())
print(meta.column_names_to_labels)  # {'HE_glu': '공복혈당', ...}
```

변수만 살펴보려면 `metadataonly=True`를 사용합니다. 큰 식품 파일을 처음 열 때는 `row_limit=100`으로 제한하고, 필요한 변수를 `usecols`로 골라 읽으세요. `row_limit`을 생략하거나 0으로 지정하면 전체 행을 읽습니다.

```python
_, meta = pyreadstat.read_sas7bdat(
    "data/raw/knhanes/2024/hn24_24rc.sas7bdat",
    metadataonly=True,
)
print(meta.column_names_to_labels)
```

CSV가 필요한 경우 선택한 `df`를 별도 파일로 저장할 수 있습니다. 아래 코드에 앞선 `usecols`를 적용했다면 해당 변수들만 내보냅니다.

```python
from pathlib import Path

Path("data/processed").mkdir(parents=True, exist_ok=True)
df.to_csv("data/processed/health_2024_selected.csv", index=False, encoding="utf-8-sig")
```

## 기존 CSV와의 차이

- SAS 원본 변수명은 대소문자를 구분합니다. 기존 CSV의 `HE_GLU`, `HE_HBA1C`와 달리 SAS에서는 **`HE_glu`, `HE_HbA1c`**입니다. 먼저 변수 목록을 확인하세요.
- 자동 인코딩 인식으로 한글을 정상적으로 읽었으므로 `encoding="utf-8"`을 강제로 지정할 필요가 없습니다. 필요할 때만 `encoding="EUC-KR"`을 명시합니다.
- `N_FCODE`는 문자열로 읽혔습니다. 숫자로 변환하면 앞자리 0이 사라질 수 있습니다.
- 원본에는 `wt_itvex`, `wt_ntr`, `wt_tot`, `kstrata`, `psu` 등이 있습니다. 분석 목적에 맞는 가중치와 표본 설계 적용법은 이용지침서를 확인해야 합니다.
- 변수 설명에 따르면 `N_TD_WT`는 **음식의 섭취량(중량, g)**, `NF_INTK`는 **식품섭취량(g)**입니다. 이전 CSV에는 `NF_INTK`가 없었으므로, `N_TD_WT` 결측만으로 식품 섭취량의 가용성을 판단할 수 없습니다.
- 이번 ZIP에는 값 라벨용 `.sas7bcat`이 없고, 읽힌 메타데이터의 값 라벨도 비어 있습니다. 한글 변수 설명이 읽혀도 성별·진단 여부 등의 숫자 코드와 8·9·88·99 등 특수 응답의 의미가 모두 해석된 것은 아닙니다. 해당 연도 이용지침서·코드북을 함께 확인하세요.

API 설명: [pyreadstat 공식 문서](https://github.com/Roche/pyreadstat#usage).

2026-10-21 추가: 제9기(2022~2024) 통합 원시자료 이용지침서와 연도별 영양조사 코드자료집이 확보되었습니다. 확인한 변수 정의와 지침서 페이지는 [데이터 설명서 메모](research/DATA_DOCUMENTS.md)에 정리했습니다.
