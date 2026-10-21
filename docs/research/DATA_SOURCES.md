# 프로젝트 데이터 출처 등록부

공식 웹 메타데이터 확인: 2026-10-21 · 로컬 파일 관찰: 2026-10-21T16:43:33+09:00

[전체 출처·해시 JSON](data_sources.json) · [데이터 활용안](CHATBOT_DATA_PLAN.md) · [시연용 가상 기록](../DEMO_DATA.md)

공식 관련 배포처를 찾은 것과 현재 로컬 파일의 정확한 다운로드 경로를 확인한 것을 구분했다. **모르는 입수일·다운로드 URL·추출 조건은 미확인으로 남겼다.** 파일 수정 시각이나 파일명 날짜를 실제 입수일로 기록하지 않았다.

## 먼저 확인할 결과

- 식약처 공식 배포 엑셀을 이미 제공했다는 사용자 확인을 반영했다. 음식 DB·가공식품 DB를 주 전처리 원본으로 삼고, 건강기능식품 DB는 초기 음식 검색과 분리해 보관한다. 추가 다운로드를 선행할 필요는 없다.
- 현재 5만 행 JSONL은 기존 CSV 기반의 참고·검증용 가공본이다. 공식 엑셀 기반 가공본으로 교체한 상태는 아니다. 다음 작업은 보유 엑셀의 머리글·단위·결측·중복을 점검해 필요한 칼럼을 추출하는 것이다.
- 식품 CSV는 50,000행의 제공기관명 칼럼이 식품의약품안전처임을 확인했다. 공공데이터포털은 사용자 전달 기준 입수 경로다. 최초 상세 URL·입수일·추출 시점·필터는 미확인이다.
- [식약처 API](https://www.data.go.kr/data/15127578/openapi.do)의 공식 페이지는 이용허락범위 제한 없음으로 표시한다. 이 조건을 원출처가 확정되지 않은 로컬 CSV의 이용조건으로 단정하지 않는다.
- 건강검진·식품섭취 CSV는 원시자료에서 누가 어떤 열과 행을 추출했는지 이력이 필요하다. SAS 원본, 기존 프로필과 원본 해시를 별도로 보존했다.
- 2024 영양조사 코드자료집은 새로 받은 XLSX와 기존 csv.zip 내부 파일의 SHA-256이 일치한다. 제9기 이용지침서 3개 사본도 해시가 같고 모두 보존했다.
- 공식 건강정보 PDF 5개는 기존 검토의 공식 게시물·버전과 연결하고 현재 파일 해시를 다시 확인했다. 원문·이미지·표의 서비스 재사용 조건은 별도 확인 대상이다.
- 식품성분표의 설명문에서 농촌진흥청 국가표준식품성분 DB 10.4(2026)와 공공누리 제1유형 출처표시 조건을 확인했다. 기본 식품·원재료 조회용이며, 현재 가공 상태는 아래 별도 항목에 기록했다. 표준수산식품 DB는 PDF 참고 자료로 보관한다.

## 출처별 목록

| ID | 자료·사용 목적 | 확인 수준 | 공식 관련 페이지 |
| --- | --- | --- | --- |
| CSV_BUNDLE | 사용자 제공 CSV 묶음 / 최초 참고 데이터 보존 | 사용자 제공 묶음 | 미확인 |
| KNHANES_HEALTH_CSV_2024 | 2024_건강검진_개인별.csv / 집단 검진 지표 탐색 | 제공기관/형식 확인 · 추출 경로 미확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_INTAKE_CSV_2024 | 2024_식품섭취_기록별.csv / 집단 식품 섭취 현황 탐색 | 제공기관/형식 확인 · 추출 경로 미확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| FOOD_CSV | 식품영양성분_핵심컬럼.csv / 기존 검색·환산 검증용 참고본; 주 데이터는 공식 XLSX로 전환 예정 | 제공기관/형식 확인 · 추출 경로 미확인 | [공식 관련 페이지](https://www.data.go.kr/data/15127578/openapi.do) |
| KNHANES_2022_24RC | 국민건강영양조사 2022 24RC SAS / 통합·식품섭취 원시자료와 변수 해석 | 사용자 전달·SAS 메타데이터 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_2022_ALL | 국민건강영양조사 2022 ALL SAS / 통합·식품섭취 원시자료와 변수 해석 | 사용자 전달·SAS 메타데이터 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_2023_24RC | 국민건강영양조사 2023 24RC SAS / 통합·식품섭취 원시자료와 변수 해석 | 사용자 전달·SAS 메타데이터 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_2023_ALL | 국민건강영양조사 2023 ALL SAS / 통합·식품섭취 원시자료와 변수 해석 | 사용자 전달·SAS 메타데이터 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_2024_24RC | 국민건강영양조사 2024 24RC SAS / 통합·식품섭취 원시자료와 변수 해석 | 사용자 전달·SAS 메타데이터 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_2024_ALL | 국민건강영양조사 2024 ALL SAS / 통합·식품섭취 원시자료와 변수 해석 | 사용자 전달·SAS 메타데이터 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_MANUAL_9 | 국민건강영양조사 제9기(2022-2024) 원시자료 이용지침서 / 변수 정의·복합표본 설계·가중치 해석 | 표지·관련 부분 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_CODEBOOK_2022 | 2022 영양조사 코드자료집 / 해당 연도 조사 식품·음식코드 해석 | 시트·해시 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_CODEBOOK_2023 | 2023 영양조사 코드자료집 / 해당 연도 조사 식품·음식코드 해석 | 시트·해시 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KNHANES_CODEBOOK_2024 | 2024 영양조사 코드자료집 / 해당 연도 조사 식품·음식코드 해석 | 시트·해시 확인 | [공식 관련 페이지](https://knhanes.kdca.go.kr/knhanes/main.do) |
| KDCA_DIABETES | 당뇨병 / 측정 시점·기록 이유·기본 지식 | 공식 문서 식별·관련 부분 검토 | [공식 관련 페이지](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=5305) |
| KDCA_EXERCISE | 당뇨환자의 운동요법 / 일반 운동 선택지·운동 전 확인 사항·합병증별 주의 | 공식 문서 식별·관련 부분 검토 | [공식 관련 페이지](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=3390) |
| KDCA_DIET | 당뇨환자의 식이요법 / 일반 영양교육·가공식품 표시 확인 | 공식 문서 식별·관련 부분 검토 | [공식 관련 페이지](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=3388) |
| KDA_GUIDELINE_2025 | 2025 당뇨병 진료지침 요약문 수정본(26.2.12) / 측정·자기관리·운동 교육의 교차 확인 | 공식 문서 식별·관련 부분 검토 | [공식 관련 페이지](https://diabetes.or.kr/bbs/?code=guide&mode=view&number=2099) |
| KDA_FACT_2026 | Diabetes Fact Sheet in Korea 2026 / 프로젝트 필요성·집단 통계 질문 | 공식 문서 식별·관련 부분 검토 | [공식 관련 페이지](https://www.diabetes.or.kr/bbs/?code=fact_sheet&mode=view&number=3220&page=1) |
| MFDS_FOOD_XLSX | 20260828_음식DB_19617건.xlsx / 음식 검색·영양정보의 주 전처리 원본 | 공식 배포 출처 사용자 확인 · 전체 내용 점검 대기 | [공식 관련 페이지](https://various.foodsafetykorea.go.kr/nutrient/general/down/list.do) |
| MFDS_PROCESSED_XLSX | 20260929_가공식품DB_323197건.xlsx / 가공식품·제품 검색의 주 전처리 원본 | 공식 배포 출처 사용자 확인 · 전체 내용 점검 대기 | [공식 관련 페이지](https://various.foodsafetykorea.go.kr/nutrient/general/down/list.do) |
| MFDS_SUPPLEMENT_XLSX | 20260623_건강기능식품DB_5556건 (3).xlsx / 건강기능식품 별도 보관; 초기 음식 검색 범위에서 제외 | 공식 배포 출처 사용자 확인 · 전체 내용 점검 대기 | [공식 관련 페이지](https://various.foodsafetykorea.go.kr/nutrient/general/down/list.do) |
| RDA_COMPOSITION_XLSX | 식품성분표(10개정판).xlsx / 기본 식품·원재료의 영양정보 조회; 10.4판 사용 | 엑셀 설명문에서 발행기관·판·기준량·표기 규칙 확인 | [공식 관련 페이지](https://koreanfood.rda.go.kr) |
| NIFS_FISH_PDF | 표준수산식품DB.pdf / 수산식품 참고 자료; 초기 엑셀 전처리의 필수 입력 아님 | 파일·메타데이터 확인 · 출처/품질 대기 | [공식 관련 페이지](https://www.data.go.kr/data/15100064/standard.do) |
| CGMACROS_1_0_0 | CGMacros: a scientific dataset for personalized nutrition and diet monitoring / 연속혈당·식사 반응 분석의 선택 확장 자료 | 공식 배포·라이선스 확인 · 본체 검증 대기 가능 | [공식 관련 페이지](https://physionet.org/content/cgmacros/1.0.0/) |

## 식품성분표 10.4 전처리

기본 식품 3,366건·핵심 영양소 7개의 CSV/JSONL과 원본 셀 보존본을 생성했다. 가공 파일 해시는 등록부 재생성 시 대조한다.

[처리 규칙·검증 결과·재현 방법](../FOOD_COMPOSITION.md). 기존 CSV 5만 행 가공본 및 식약처 엑셀과 별도 자료다. 다른 DB와 코드·이름만으로 자동 병합하지 않는다.


## CGMacros 다운로드 확인

[공식 배포 페이지](https://physionet.org/content/cgmacros/1.0.0/) · [공개 체크섬](https://physionet.org/files/cgmacros/1.0.0/SHA256SUMS.txt)

공식 페이지의 라이선스는 **CC-BY-NC-SA-4.0**으로 기록했다. 내려받은 `LICENSE.txt`는 0바이트지만 빈 파일의 해시 자체가 공식 체크섬과 일치하므로, 라이선스가 없다고 해석하지 않는다. 현재 기능의 필수 입력으로 채택하지 않았으며 다운로드는 중단·재시작하지 않았다.

| 파일 | 상태 |
| --- | --- |
| CGMacros_dateshifted365.zip | 다운로드 미완료 · 해시 검증 대기 |
| DataDictionary.pdf | 공식 SHA-256 일치 |
| DataDictionary_Bio.csv | 공식 SHA-256 일치 |
| DataDictionary_CGMacros-00X.csv | 공식 SHA-256 일치 |
| DataDictionary_Gut_Health_Test.csv | 공식 SHA-256 일치 |
| DataDictionary_Microbes.csv | 공식 SHA-256 일치 |
| LICENSE.txt | 공식 SHA-256 일치 |

다운로드 상태는 위 관찰 시각의 스냅샷이다. 나중에 아래 명령을 다시 실행하면 로컬 관찰과 해시 검증 상태를 갱신한다. 웹페이지의 조건·버전을 다시 확인하는 명령은 아니다.

```powershell
python scripts/catalog_data_sources.py
```

## 보완할 출처 정보

| 우선순위 | 필요한 정보 | 기록할 내용 |
| --- | --- | --- |
| 높음 | 보유한 공식 식품 엑셀 전처리 | 음식·가공식품 DB의 칼럼 대응, 기준량·단위, 결측, 중복 코드와 출처 보존 |
| 보통 | 공식 엑셀의 파일별 배포 기록 | 상세 배포 URL·실제 입수일·버전·이용조건. 출처 사용자 확인은 기록 완료 |
| 보통 | 국민건강영양조사 자료 입수 기록 | 해당 연도 상세 배포 페이지, 실제 입수일, 배포본 이용약관 |
| 후속 | 기존 식품 CSV 전달 이력 | 상세 URL·추출 시점·필터·이용조건. 공식 엑셀 전처리를 위해 먼저 해결할 필요는 없음 |
| 후속 | 수산식품 및 추가 성분 | 수산식품 PDF는 필요한 항목만 검토. 식품성분표의 핵심 7개 외 성분은 원본 셀 보존본에서 후속 정규화 |

확인되지 않은 항목이 있어도 가상 시연 기록 생성과 조회·집계 검증용 사례 준비는 진행할 수 있다. 현재 정리에서는 원자료를 이동·삭제하거나 앱·원격 문서를 수정하지 않았다.

논문과 문헌 서지는 [기존 문헌 등록부](references.json)에 유지했다. 이 등록부는 그 내용을 대체하지 않는다.
