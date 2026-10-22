# 챗봇 참고자료 이용조건과 대체 후보

확인일: 2026-10-22. 범위는 일반 건강정보 FAQ의 원자료·요약문·RAG 입력·답변·저장소 공유다. 아래는 확인된 조건과 후속 검토 사항이며, 개별 요약문에 대한 법적 침해 판단은 아니다. [이용허락 문의 초안](SOURCE_PERMISSION_REQUESTS.md)을 함께 참고한다.

후속 작업: 문의 초안은 보관하고, [대체 FAQ 13개와 예시 6개](chatbot_replacement_v1/README.md)를 작성했다. N03은 고시 규범 본문으로, X02는 벽밀기·팔 들기로 예시 범위를 조정해 근거를 연결했다. 아래 C1~C4는 새 자료집에서 각각 R1~R4로 표기한다. 앱 반영·의료 내용 승인과는 별개다.

## 현재 자료에서 확인한 조건

| 자료 | 확인 근거 | 현재 판단 |
| --- | --- | --- |
| 질병관리청 당뇨병·식이요법·운동요법 | 각 원문 하단 및 [건강정보 활용방법](https://health.kdca.go.kr/healthinfo/biz/health/portalUseGuidance/hlthinsReqst/hlthinsReqstMth.do?index=1): 공공누리 제4유형, 출처표시·상업적 이용금지·변경금지 | 비영리라는 이유만으로 요약·재구성·생성형 답변까지 허락되었다고 볼 수 없다. 현재 이용 방식에 대한 별도 확인 필요 |
| 대한당뇨병학회 2025 진료지침 요약문, 2026-02-12 수정본 | [공식 배포 게시물](https://diabetes.or.kr/bbs/?code=guide&mode=view&number=2099), 보관 중인 PDF | 공개 다운로드는 확인했으나, 해당 PDF의 RAG·요약문 배포를 허락하는 명시적 조건은 찾지 못했다. 학회 확인 필요 |
| 농촌진흥청 국가표준식품성분 DB 10.4 | 로컬 엑셀 `DB 설명` 시트의 공공누리 제1유형 안내. 확인 기록: [FOOD_COMPOSITION.md](../FOOD_COMPOSITION.md#검증-범위와-출처) | 출처표시 조건을 확인한 영양성분 조회 후보. 당뇨 교육·운동 안내 근거를 대신하지는 않는다. 정확한 최초 다운로드 상세 URL은 미확인 |
| CGMacros 1.0.0 | [PhysioNet 원배포 페이지](https://physionet.org/content/cgmacros/1.0.0/): CC BY-NC-SA 4.0 | 현재 FAQ/RAG 자료에 포함하지 않았다. 향후 이용 시 비상업·동일조건변경허락을 별도로 검토 |
| Gemma 4 E4B IT QAT Q4_0 GGUF | [Google 공식 모델 저장소](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf): Apache-2.0, [라이선스 원문](https://ai.google.dev/gemma/apache_2) | 모델 이용조건과 참고자료 이용조건은 각각 검토한다. 가중치 등을 재배포하면 해당 라이선스의 고지·배포 조건 확인 필요 |

질병관리청의 API 이용 신청·승인은 요약이나 AI 답변 생성을 별도로 허락하는지 확인해야 한다. 출처 링크를 붙이는 것만으로 변경금지 조건이 해소되는 것도 아니다. 반대로 사실·아이디어와 보호되는 표현의 구분이 있으므로, 위 조건 확인을 곧바로 모든 요약문의 침해 확정으로 표현하지 않는다.

질병관리청 원자료:

- [당뇨병](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=5305): `KDCA_DIABETES`
- [당뇨환자의 식이요법](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=3388): `KDCA_DIET`
- [당뇨환자의 운동요법](https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=3390): `KDCA_EXERCISE`

## 대체 자료 후보

여기의 후보 ID는 이 검토 문서에서만 사용한다. 원래 출처 등록부나 앱의 승인 상태를 변경한 것은 아니다. **이용조건 확인과 한국어 답변의 의학적 검토는 별도다.**

### C1. NIDDK — Managing Diabetes

- 원문: <https://www.niddk.nih.gov/health-information/diabetes/overview/managing-diabetes>
- 원문에 표시된 최종 검토: 2023년 10월. 이번 확인: 2026-10-22.
- 검토 대상 절: `A is for the A1C blood glucose test`, `How can I check my blood glucose level at home?`, `Recommended targets for blood glucose levels`.
- 대응 후보: B01·B02·B03·B04. 즉시 혈당과 장기 검사 구분, 식사 시작을 기준으로 한 측정 시점, 기록 맥락, 개인별 측정 계획에 관한 근거를 찾았다. 개인 치료 목표 수치는 이번 대체 초안의 범위에 넣지 않는다.

### C2. NIDDK — Healthy Living with Diabetes

- 원문: <https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes>
- 원문에 표시된 최종 검토: 2023년 10월. 이번 확인: 2026-10-22.
- 검토 대상 절: `How can I plan what to eat or drink when I have diabetes?`, `Do different types of physical activity`, `Stay safe during physical activity`.
- 대응 후보: N01·N02, X01·X03·X04. X02는 원문의 운동 예시와 현재 카드의 실내 자전거·탄력밴드 구성이 달라 부분 대응이다. X05의 개인 운동 허가 거절은 서비스의 제한으로 유지하고, 단일 혈당값으로 안전을 판정하는 규칙을 새로 만들지 않는다.

**C1·C2 공통 이용조건:** [NIDDK Copyright](https://www.niddk.nih.gov/copyright), `Reproducing Content, Logos, and Graphics` 및 `Editing Content`를 확인했다. 대부분의 자료를 자유롭게 내려받아 복제할 수 있다고 안내하며, 편집물의 기관 로고 제거와 기관 보증 오인 방지를 요구한다. 특정 의료 조언·치료·의뢰를 권하는 용도로 쓰면 안 된다. 공동 제작물·일부 그래픽은 예외다. 따라서 기관 자체 교육 본문만 우선 검토하고, 연결된 외부 자료·그림의 권리를 함께 허락받은 것으로 처리하지 않는다. 일반 교육용 한국어 재구성 후보로 두되, 이번 프로젝트의 RAG 이용을 명시적으로 승인받았다는 의미는 아니다.

### C3. Klammer 외 — Nutrition recommendations for people with diabetes (Update 2026)

- 원문 및 권리표시: <https://link.springer.com/article/10.1007/s00508-025-02676-7>
- 서지: Klammer C, Schindler K, Bugl R, et al. *Wiener klinische Wochenschrift* 138 (Suppl 4), 122–141. 공개일 2026-04-30. DOI: `10.1007/s00508-025-02676-7`.
- 라이선스: 원문 `Rights and permissions`에 **CC BY 4.0** 명시. 저자·출처, [라이선스 링크](https://creativecommons.org/licenses/by/4.0/), 변경 사실을 표시하면 복제·공유·재구성이 허용된다. 별도 표시된 제3자 자료는 예외다.
- 대응 후보: N01·N02, N04의 통과일·주스 차이. N04는 본문 `4.2 Gemüse und Obst`를 확인했다.
- 한계: 독일어 권고문이다. 번역과 국내 적용을 검토해야 하며 국내 ‘무가당’ 표시의 법적 정의를 대신하지 않는다. 치료·인슐린 조정 내용은 이번 일반 교육 FAQ에 편입하지 않는다.
- 표기 예: `Klammer et al. (2026), DOI: 10.1007/s00508-025-02676-7, CC BY 4.0. 본 프로젝트가 일반 교육용으로 한국어 번역·요약했으며 원문과 차이가 있습니다.` 실제 적용 시 원문·라이선스에 링크한다.

### C4. 식약처 — 식품등의 표시기준 제2025-60호

- 원문: [공식 고시전문과 첨부 HWPX](https://www.mfds.go.kr/brd/m_211/view.do?seq=14917), [국가법령정보센터 해당 버전](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000263558).
- N03 대응: 별지 1, 1. 아.의 표시단위, 탄수화물·당류 표시방법, 당류 ‘무’ 함량 기준, 무가당 제조·원재료 조건을 확인했다. 확인일은 2026-10-22다.
- 이용 근거: [저작권법 제7조제2호](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1029423769)의 국가 고시 규범 본문이다. KOGL 또는 CC 라이선스를 부여한 것으로 표기하지 않는다. 식약처 뉴스레터의 최근 설명과 대조했지만 그 이미지·편집물·대체 텍스트는 지식자료에 넣지 않았다.
- 2026년 고시 제2026-37호는 2028년 시행 예정이므로 이미 시행 중인 기준으로 사용하지 않는다. 제품별 경과조치나 표시 적법성 판단은 범위 밖이다.
- 원본·해시·세부 위치는 [새 출처 등록부](chatbot_replacement_v1/SOURCES.json)에 보관했다.

### 바로 채택하지 않은 후보

| 후보 | 이유 |
| --- | --- |
| [CDC 당뇨 교육자료](https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html) | [CDC 자료 이용정책](https://www.cdc.gov/other/agencymaterials.html)은 많은 자료를 public domain으로 안내하지만, 출처·비보증·무료 원문 안내 및 실질 내용 변경금지 조건도 제시한다. 해외 이용과 제3자 자료도 구분한다. 자유로운 번역·생성형 재구성 허락으로 단정하지 않는다 |
| [NHS 웹사이트 자료](https://www.nhs.uk/our-policies/terms-and-conditions/) | OGL 기반 재구성이 가능하지만 별도 조건이 우선한다. 번역은 adaptation으로 분류하며 변경물의 표기 방식도 별도로 정한다. 기존 UI가 기대하는 기관별 출처표시 방식과 함께 검토할 후순위 후보 |

## 현재 13개 FAQ에 대한 대체 가능성

아래는 **근거를 찾은 범위**다. 기존 요약문을 그대로 유지하고 출처 URL만 바꾸어도 된다는 뜻은 아니다. 원문 절을 기준으로 독립적으로 문안을 다시 쓰고, 조건·거절 문안까지 검토해야 한다.

| 현재 ID | 대체 후보 / 확인 범위 | 남은 작업 |
| --- | --- | --- |
| B01 | C1 — A1C와 현재 혈당 | 수기 평균을 검사 결과로 대체하지 않는 서비스 설명과 구분 |
| B02 | C1 — 식사 시작 기준의 약 2시간 | 한국어 측정 시점 문안 검토 |
| B03 | C1 — 날짜·시간·음식·활동 기록 | 메모가 원인을 증명하지 않는다는 서비스 설명 구분 |
| B04 | C1 — 측정 방식·횟수는 의료진과 상의 | 개인별 횟수 처방 거절 유지 |
| N01 | C2·C3 — 식사 구성·개별 계획 | 국내 식생활에 맞춘 표현 검토 |
| N02 | C2·C3 — 탄수화물과 식사 계획 | 극단적 제한이나 개인 섭취량 처방으로 확장하지 않기 |
| N03 | C4 — 국내 무가당·무당 표시와 영양정보의 기준량 | 고시 원문으로 대체 초안 작성. 제품별 적법성·혈당 반응 판정은 제외 |
| N04 | C3 — 통과일·주스, 섬유질 차이 | 해당 절 번역·섭취량 관련 표현 검토 |
| X01 | C2 — 걷기와 활동 나누기 | 기존 활동 수준·건강상태 조건 포함 |
| X02 | C2 — 벽밀기·팔 들기 | 새 카드의 활동 종류를 원문에 맞게 수정. 기존 자전거·밴드 사용법의 근거를 확보한 것은 아님 |
| X03 | C2 — 활동 전후 혈당과 저혈당 위험 | 투약 여부 등 조건 누락 여부 검토 |
| X04 | C2 — 새 활동 전 상담과 건강상태 고려 | 기존 문안의 구체적 점검 항목별 근거 대조 |
| X05 | C2 부분 대응 — 운동 계획의 개별성 | ‘혈당 하나로 운동 허가 불가’는 서비스 제한. 개인별 허가 기준을 만드는 데 사용하지 않기 |

B05·N05는 제품 규칙과 의료 자료가 섞인 항목이라 현재 미리보기 검색 대상에서 제외된다. 개인 기록 FAQ P01~P05의 데이터 처리·권한 설명은 별도로 관리한다. 별도로 작성한 [예시 카드 6개](chatbot_replacement_v1/EXAMPLES.md)는 새 식품군·활동 근거를 연결한 초안이며, 의학적 검토를 완료한 것은 아니다.

## 현재 앱·저장소와 후속 작업

- 이전 [knowledge.json](chatbot_v5/knowledge.json)은 보존했다. 현재 봇은 [대체 자료집](chatbot_replacement_v1/knowledge.json)의 13개 항목을 읽으며, 새 자료집도 배포·내용·의료·이용조건 승인은 미승인이다. 질병관리청·학회 자료는 현재 모델 요청에서 제외했다.
- [knowledge.ts](../../src/lib/assistant/knowledge.ts)의 일반 경로는 자료집·항목·출처 승인과 재검토 기한을 확인한다. [service.ts](../../src/lib/assistant/service.ts)의 초안 예외는 `session.mode === "demo"`와 `ASSISTANT_ALLOW_DRAFT_PREVIEW=1`을 모두 만족할 때다. 이 설정만으로 서버가 로컬에만 바인딩되는 것은 아니므로, 외부 접속 가능한 데모를 열 때도 초안 노출 여부를 확인해야 한다.
- 런타임 차단과 저장소 공유는 별개다. 원격 `feat/assistant-rag`의 확인 당시 커밋 `51525a0521ec18835772e7032934d6e5e579e470`에는 FAQ·예시·구조화 요약문이 포함되어 있었다. 저장소 공개 여부는 이 검토에서 확정하지 않았으며, 공유된 파생 자료의 이용 범위도 문의 대상에 넣었다.
- 검색·표시 코드는 웹문서의 절과 고시 조항 인용, 발행기관·저자·이용조건·변경 사실을 지원하도록 변경했다. 원문에 없는 PDF 쪽수는 만들지 않는다.
- 개인 공복 기록의 건수·평균·최소·최대 계산은 이 외부 교육자료의 대체 작업과 별개다.

현재 후속 작업:

1. [기관별 문의 초안](SOURCE_PERMISSION_REQUESTS.md)은 보관한다. 대체 자료 준비를 우선하며 문의는 발송하지 않았다.
2. C1~C4의 본문·이용조건·원본 해시와 13개 FAQ·6개 카드 대응을 [새 초안](chatbot_replacement_v1/README.md)에 기록했다. 식단 조합과 운동 허가 거절 등 제품 규칙은 외부 의료 근거와 구분했다.
3. 새 문안의 의료 내용·한국어 표현·이용조건을 각각 검토한다. 현재 승인값은 미승인으로 유지한다.
4. 개발용 미리보기의 자료집·인용 방식은 연결했다. [별도 회귀 평가본](assistant-eval-replacement40/cases.json)에 변경된 기대 결과를 명시했으며, 내용 승인과 실제 모델 응답 평가는 구분한다.

대체 자료집을 현재 봇에 연결했으며 기존 자료·문의 초안은 보존했다. 공개 서비스 승인값은 변경하지 않았다.
