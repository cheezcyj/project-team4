# 대체 근거의 앱 연결 및 검증 기록

확인일: 2026-10-22. 기술적 연결을 확인한 기록이며 의료 내용·팀·공개 서비스 승인이나 실제 모델 답변 품질의 통과 기록은 아니다.

## 변경한 동작

앱은 이전 `chatbot_v5/knowledge.json` 대신 이 폴더의 `knowledge.json`을 검색한다. FAQ 13개가 다음 4개 출처에 연결된다. 원문 위치와 이용조건은 [SOURCES.json](SOURCES.json)에 기록했다.

| 출처 | 연결 범위 |
| --- | --- |
| R1 NIDDK Managing Diabetes | B01~B04: 검사·측정·기록의 일반 교육 |
| R2 NIDDK Healthy Living with Diabetes | X01~X05: 신체활동 교육. X05는 제품 제한의 배경 근거 |
| R3 Klammer 외, Ernährungsempfehlungen für Menschen mit Diabetes (Update 2026) | N01·N02·N04: 식사 구성·탄수화물·과일 |
| R4 식약처 고시 제2025-60호 | N03: 국내 영양표시·무당·무가당의 구분 |

실내 운동 예시는 벽밀기·팔 들기다. 자전거·탄력밴드 질문에 이 예시를 기구 사용법의 근거로 붙이지 않는다. 모델에는 선택된 요약·조건·절·출처 ID를 전달하며 이전 출처 ID를 반환하면 거부한다. 웹문서에 가상의 PDF 쪽수를 붙이지 않고 절·고시 조항, 저자·기관, 이용조건 링크, 한국어 요약·재구성 사실을 표시한다.

개인 기록 계산·동의 처리와 모델 가중치·로드 설정은 이번 교체에서 변경하지 않았다. 자료집의 승인 값은 모두 미승인으로 유지하며 기존 demo 모드의 명시적 초안 미리보기에서만 사용한다.

## 검증 결과

| 검사 | 결과와 확인 범위 |
| --- | --- |
| `npm run test:unit` | 68/68 통과. 13개 FAQ 각각의 새 출처 선택과 전달 내용을 모의 모델 호출로 확인 |
| `npm run lint` / `npm run typecheck` | 통과 |
| `npm run build` | 통과 |
| Chrome Playwright `assistant.spec.ts`, `assistant-shell.spec.ts` | 8/8 통과. API 접근·동의·오류 처리와 모바일 출처 표시 확인. 생성 응답은 모의 응답 |
| `python scripts/prepare_assistant_replacement.py --check` | 생성 자료집·내용 해시·입력 해시 재현성 확인 |
| `python scripts/evaluate_assistant.py` | 대체 자료 40문항의 구조와 안내문 일치 확인. 실제 질문 실행은 아님 |
| 로컬 앱 `/api/health` | `status: ok` |
| 실제 모델 답변 / 새 40문항 실행 | 미실행. 확인 시 설정된 `127.0.0.1:1234` 모델 서버가 응답하지 않았으며 모델을 대신 로드하지 않음 |

로컬 상세 로그는 `.tmp/research/replacement-runtime-check/`의 `unit.log`, `build.log`, `e2e.log`에 있다. 화면 증거는 `.local/playwright-results/`의 `assistant-answer-360.png`, `replacement-credits-360.png`다. 이 로컬 경로들은 Git 공유 대상이 아니다.

## 재현 식별값과 보존 확인

- 자료집 버전: `replacement-v1-draft-1`
- 자료집 SHA-256: `a489329240b297eefaae427d5e0fd6031e348a36ee37cea952664bbc965ca5e5`
- 대체 40문항 SHA-256: `13f05acb68e6e7c5db5f491b857a916e8178cc5f5717335867a63510374419bd`
- 검사한 앱 빌드 ID: `CgtWL7Qj8GgSV2xVyh77a`
- `.gitattributes`로 FAQ·출처 등록부·생성 자료집·고정 문항의 바이트를 보존한다. Git의 줄바꿈 자동 변환이 입력 해시와 평가 식별값을 바꾸지 않게 한다.
- 문의 초안·이전 `chatbot_v5` 자료집/FAQ/예시·루트 README는 교체 전 해시와 일치한다.
- 기존 40문항 JSON·안내문은 HEAD 내용과 일치한다. 기존 실행 결과를 새 자료의 성능으로 재해석하지 않는다.

다음 확인은 사용자가 모델 서버를 실행한 뒤 새 40문항을 별도 실행 폴더에 저장하고, 답변의 내용·조건 누락·출처 적합성을 직접 검토하는 것이다. 위 검증을 마친 시점에는 커밋·푸시·PR 생성 전 로컬 상태였다.
