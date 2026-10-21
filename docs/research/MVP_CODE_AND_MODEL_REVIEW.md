# 원격 MVP 코드 확인과 AI 도우미 모델 검토

확인일: 2026-10-21. 원격 `main`의 [`31af976`](https://github.com/cheezcyj/project-team4/commit/31af9765a00939ebeb630cf651a4832c33864806) 「로컬용 MVP 구현」을 기준으로 확인했다. 데이터 준비 결과와 앱 구현의 차이, AI 도우미 모델 후보 및 뉴스 연결 시 확인할 항목을 정리한 검토 문서다. 검토 과정에서 앱 코드는 수정하지 않았다.

실제 설치·검사는 `.tmp/research/upstream-mvp-31af976/`에 추출한 별도 검토본에서 수행했다. 자료 공유용 PR은 위 원격 버전을 기준으로 데이터 준비 파일과 이 검토 문서를 추가하며, 팀의 앱 코드와 루트 README를 유지한다. 아래 실행 결과는 별도 검토본에서 확인한 결과다.

## 코드에서 확인한 현재 상태

Next.js 16.4.2·React 19.3.1·TypeScript 기반 앱이다. 서버 저장 방식은 로컬 가상 계정·파일 저장과 Supabase 연동으로 구분돼 있다. Supabase 없이 로컬 시연을 실행할 수 있고, 별도 Supabase 프로젝트를 연결하는 SQL과 안내도 포함돼 있다.

| 항목 | 코드에서 확인한 내용 | 확인 범위 |
| --- | --- | --- |
| 로그인·동의·계정 | 가상 계정 모드와 Supabase 세션 처리, 동의 및 계정 삭제 | 정적 검토·단위/격리 DB 검사, 가상 계정 HTTP 확인 |
| 혈당 기록 | 측정 상황 10개, 선택적 식사 시간대, 기록 추가·수정·삭제 | 도메인 코드·검증·SQL·기존 테스트 확인 |
| 식사 기록 | 음식 선택·직접 입력, 당시 영양정보의 스냅샷 보관 | 타입·서비스·검증·기존 테스트 확인 |
| 조회·비교 | 일지·캘린더·기간 리포트·같은 상황과 식사 시간대의 비교 | 화면·계산 코드·기존 테스트 확인 |
| CSV 가져오기 | UTF-8, 열 연결, 미리보기, 2MiB·1,000행, 전체 저장·중복 방지 | 서비스·도메인·SQL·기존 테스트 확인 |
| 정책·혜택 | 선택한 조건을 공식 정책과 비교하는 별도 기능 | 코드·기존 테스트 확인. 정책의 현행성 자체를 재조사한 것은 아님 |
| 음식 검색 | 기본 공개 식품 8개와 로컬 식품 카탈로그 읽기 | HTTP에서 `source=built_in`, 8개 응답 확인 |
| 건강 뉴스 | 화면은 빈 목록, 서버는 `configured:false` 응답 | 코드와 HTTP로 미연결 확인 |
| AI 도우미 | 열기·닫기·입력 초안·바로가기만 있고 전송 비활성화 | 코드에서 전송 로직 부재, `/api/assistant`는 HTTP 404 확인 |

뉴스는 [`news-screen.tsx`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/components/information/news-screen.tsx)가 `/api/news`를 호출하지 않는다. [`listNews`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/lib/server/services.ts)는 빈 결과와 미설정 상태를 반환한다. 따라서 외부 API를 서버에 붙이는 일과 화면의 조회·로딩·실패 처리를 연결하는 일이 모두 남아 있다.

도우미는 [`assistant-widget.tsx`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/components/assistant/assistant-widget.tsx)에 화면 틀이 있다. 질문 전송 API, 모델 호출, 지식 검색, 개인 기록 참고 동의 처리와 도우미 답변은 아직 없다. 현재 `user_consents`와 혜택 조건 설정을 AI 이용 동의로 대신 취급하면 안 된다.

## 직접 실행한 검사

검토본에서 Node.js `v24.16.0`, npm `12.0.2`로 `npm ci --ignore-scripts --no-audit --no-fund` 후 `npm run check`를 실행했다.

| 검사 | 결과 |
| --- | --- |
| ESLint | 통과 |
| TypeScript 검사 | 통과 |
| 단위 테스트 | 35개 통과, 실패 0개 |
| 기본 SQL 검사 | 격리 PGlite에서 70개 통과 |
| 비 AI 기능 SQL 검사 | 격리 PGlite에서 62개 통과 |
| 계정 삭제 검사 | 격리 환경에서 18개 통과 |
| Next.js 프로덕션 빌드 | 통과 |
| 로컬 HTTP 확인 | 상태 응답, 비로그인 기록 접근 차단, 가상 계정 기록 조회, 기본 음식 8개, 뉴스 미설정, 도우미 API 부재 확인 |

HTTP 확인은 `127.0.0.1:3197`의 가상 계정 모드에서 수행했다. 시연 서버는 확인 후 종료했다. 실제 Supabase 프로젝트·이메일 인증·운영 배포·브라우저 E2E·실제 뉴스 호출·모델 추론은 검증하지 않았다.

설치/검사 로그: `.tmp/research/mvp-npm-install.log`, `.tmp/research/mvp-check.log`. HTTP 결과: `.tmp/research/mvp-review-20261021/http_smoke.json`. 이들은 로컬 검토 자료다.

## 기존 데이터 준비본과 맞춰야 할 차이

1. **측정 상황이 4개에서 10개로 확장됐다.** 현재 코드는 `fasting`, `before_meal`, `after_meal`, `after_meal_2h`, `on_waking`, `before_sleep`, `nighttime`, `before_exercise`, `after_exercise`, `other`를 사용한다. 기존 지식 준비본의 한글 4개 상황을 현재 저장값과 대응시켜야 한다. 일반 식후와 식후 2시간을 합치지 않는다.
2. **`meal_slot`이 실제 코드에 있다.** 아침·점심·저녁·간식을 선택할 수 있다. 기존 v5 문서 검토 시점에는 이 필드가 없다고 기록했지만, 이번 원격 코드에서는 추가돼 있다. 식사 관련 상황에서는 같은 시간대끼리 비교하고 미지정은 미지정끼리 비교하는 현재 규칙을 도우미에도 적용해야 한다.
3. **식사 데이터가 별도로 있다.** `meal_records`, `meal_items`와 영양 스냅샷 구조가 있다. 혈당의 식사 메모와 별도 식사 기록을 같은 데이터로 취급하거나, 연결키 없이 특정 식사가 혈당 변화의 원인이라고 단정하지 않는다.
4. **준비한 식품성분표가 자동 연결된 상태는 아니다.** 기본 검색은 8개 식품이다. 앱의 기존 import 도구는 옛 영양 CSV의 정확한 13열과 최대 100,000행을 전제로 한다. RDA 10.4 JSONL·확장 CSV를 그대로 읽지 못하며, 식약처 가공식품 323,197행도 현재 한도를 넘는다.
5. **카탈로그 변환과 사용 승인 상태를 별도로 맞춰야 한다.** 기존 import 도구는 로컬 미리보기용 `status=approved`, `unit_validated=false` 자료를 만든다. 이는 RDA 자료의 출처·단위·재사용 확인을 대신하지 않는다. RDA의 미측정·미량·인용/환산 정보도 현재 앱의 단순 숫자/null 필드만으로는 모두 표현되지 않는다.
6. **지식 JSON은 아직 초안이다.** [v5 준비본](chatbot_v5/README.md)의 `runtime_publishable=false`와 검토 상태를 유지했다. 현재 앱에 맞춘 변환, 출처·내용 검토 및 승인 뒤 검색 자료에 넣어야 한다.

근거: [`types.ts`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/lib/domain/types.ts), [`service-types.ts`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/lib/domain/service-types.ts), [`analytics.ts`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/lib/domain/analytics.ts), [`food-catalog-import.mjs`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/scripts/lib/food-catalog-import.mjs), [`food-catalog.ts`](https://github.com/cheezcyj/project-team4/blob/31af9765a00939ebeb630cf651a4832c33864806/src/lib/server/food-catalog.ts).

## 도우미는 어떤 구조로 시작할 것인가

다음은 구현 제안이며 현재 앱에 추가한 코드가 아니다. 1차는 **공개 가중치 모델 + 검토한 자료 검색(RAG) + 정해진 기록 집계**로 시작하는 편이 적절하다. 검색한 근거를 입력에 붙여 답하게 하는 방식은 지식을 바꿀 때 모델 재학습 없이 자료를 교체할 수 있다. 다만 검색 결과가 틀리거나 모델이 근거를 벗어나면 오답이 생길 수 있으므로 실제 답변 평가는 필요하다. [Hugging Face의 RAG 설명](https://huggingface.co/docs/smolagents/main/en/examples/rag).

처음부터 문서 몇 개를 학습시켜 의료 지식 모델을 만드는 것으로 목표를 잡지 않는다. 현재 FAQ·교육 자료는 검색과 답변 규칙의 시작 자료이며 충분한 학습·독립 평가 데이터가 준비됐다고 보지 않았다. 추가 학습은 기본 모델의 실제 실패 사례를 모은 뒤 말투·지시 준수 등 개선 목적과 평가 방법을 정해서 판단한다.

흐름은 `도우미 화면 → 앱의 서버 API → 질문 유형·동의·접근 범위 확인 → 승인 지식 검색 또는 본인 기록 집계 → 로컬 모델 서버 → 근거와 함께 응답`으로 제안한다. 모델이 DB의 사용자 번호나 SQL을 임의로 결정하게 하지 않는다.

| 질문 유형 | 서버가 준비할 것 | 모델의 역할 |
| --- | --- | --- |
| 일반 지식·교육용 식사·운동 | 승인된 지식과 출처 ID·버전·페이지 | 근거 범위에서 설명하고 정보 부족을 알림 |
| 어제·오늘 또는 최근 기간 비교 | 인증된 본인 기록의 기간·측정 상황·식사 시간대별 집계 | 이미 계산한 값과 기록 한계를 설명 |
| 음식 영양정보 | 확인한 식품과 기준량·단위·결측 표시 | 확인된 값의 의미 설명. 값을 기억에서 생성하지 않음 |
| 진단·약/인슐린 용량·현재 위험 증상 | 검토한 거절·도움 안내와 처리 우선순위 | 개인 치료를 정하지 않도록 제한하고 별도 평가 |

개인 기록 참고 선택은 별도로 추가해야 한다. 로컬 추론과 외부 제공사 호출을 구분하고, 외부 전송을 도입하면 그 동의와 제공사 조건도 별도로 확인한다. 기존 로그아웃 초기화 이벤트에 더해 기록 수정·삭제·동의 철회 시 진행 중 요청 취소와 이전 개인 맥락 제거를 연결해야 한다. 초기에는 대화를 영구 저장하지 않는 기준을 유지한다.

Next.js 서버에서 모델을 직접 로드하기보다 별도 모델 서버의 호환 API를 호출하면 모델 교체와 앱 개발을 분리할 수 있다. Windows 로컬 환경은 [llama.cpp 서버](https://github.com/ggml-org/llama.cpp/tree/master/tools/server), 별도 GPU 서버는 각 모델이 안내하는 vLLM 등 런타임을 비교할 수 있다. 구체적인 양자화 파일과 런타임 버전 조합은 아직 시험하지 않았다.

## Hugging Face 모델 후보

공식 배포자의 모델 카드·config·라이선스를 확인했다. 아래는 실제 한국어 건강 도우미 품질을 비교한 순위가 아니라, 구현에 착수할 후보와 비교 이유다. 현재 실행할 PC·서버의 GPU/RAM 조건은 미확정이므로 모델·양자화·동시 사용자 수를 최종 선정하지 않았다.

| 후보 | 확인한 특성 | 이 프로젝트에서의 판단 |
| --- | --- | --- |
| [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) | 4B, Apache-2.0, 비추론 출력 전용 | 짧은 한국어 설명·검색 근거 답변의 첫 기준 모델 후보. 추론 모드 제어를 별도로 넣는 부담이 적음 |
| [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) | 언어 모델 4B와 비전 인코더, Apache-2.0, 기본 추론 모드 | 같은 자료로 비교할 후보. 초기 텍스트 기능에서는 비전이 필수는 아니며, 비추론 설정과 런타임 지원 확인이 필요 |
| [EXAONE-4.0-1.2B](https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-1.2B) | 한국어 지원을 명시한 1.2B, 추론/비추론 모드 | 가벼운 비교 후보. 한국어 품질·근거 준수는 실측 필요. Apache 계열과 다른 이용조건을 함께 검토 |

Qwen3-4B-Instruct-2507은 모델 카드상 `<think>` 블록을 만들지 않는 비추론 모델이다. Qwen3.5는 기본적으로 추론하며, 호환 서버 예제에서는 `chat_template_kwargs.enable_thinking=false`로 직접 응답을 설정한다. 두 모델의 실행 인수를 같은 것으로 가정하지 않는다. [Qwen3 카드](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), [Qwen3.5 카드](https://huggingface.co/Qwen/Qwen3.5-4B).

EXAONE 4.0의 현재 라이선스는 연구·교육 목적을 포함하는 `EXAONE AI Model License Agreement 1.2 - NC`다. 배포·상업 이용은 Apache-2.0과 동일하게 취급하지 않는다. 이 문서는 법적 사용 승인을 대신하지 않는다. [공식 라이선스](https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-1.2B/blob/main/LICENSE).

| 모델 | 조사한 revision |
| --- | --- |
| Qwen3-4B-Instruct-2507 | `cdbee75f17c01a7cc42f958dc650907174af0554` |
| Qwen3.5-4B | `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` |
| EXAONE-4.0-1.2B | `3abf2810673c7c0778df64a73c2d52eab32d91c4` |

모델 파일은 가중치가 아닌 README·LICENSE·config만 받았다. revision·파일별 해시는 `.tmp/research/mvp-review-20261021/model-sources/manifest.json`에 남겼다. 모델 다운로드·GPU 로딩·추론·미세조정은 수행하지 않았다. 4B라는 이름만으로 필요한 VRAM이나 응답 속도를 확정하지 않는다.

## 뉴스 API는 어떻게 연결할 것인가

신규 연동 후보로 NAVER API HUB의 뉴스 검색을 확인했다. 기존 개발자센터 검색 API 신규 신청은 중단돼 있으므로, 오래된 `openapi.naver.com` 예제를 새 API HUB 키와 섞어 쓰면 안 된다. [공식 이관 공지](https://developers.naver.com/notice/article/32530), [이관 가이드](https://guide.ncloud-docs.com/docs/apihub-migration).

현재 공식 뉴스 API의 주소는 `GET https://naverapihub.apigw.ntruss.com/search/v1/news`이며, 인증 헤더는 `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`다. 키는 서버 환경변수에만 두고 브라우저로 보내지 않는다. [공식 뉴스 검색 문서](https://api.ncloud-docs.com/docs/naver-api-hub-search-news).

API 결과의 `pubDate`는 뉴스가 네이버에 제공된 시각이며 원문 발행 시각과 항상 같다고 볼 수 없다. 또한 별도 언론사명 필드는 없으므로 `source`를 검색 제공자나 확인한 원문 호스트와 구분해 매핑해야 한다. 기존 `HealthArticle`에 기계적으로 넣기보다 표시할 날짜·출처의 의미를 맞춘다. [응답 필드 정의](https://api.ncloud-docs.com/docs/naver-api-hub-search-news).

연결할 때는 서버의 뉴스 조회와 화면의 호출·로딩·오류·빈 결과 처리를 함께 구현해야 한다. 외부 API 키가 없는 상태, 인증 실패, 한도 초과, 타임아웃도 구분해 확인한다. 검색 결과를 임의로 승인된 의학 지식으로 넣지 않는다.

검색 결과의 가공·표시·저장·AI 입력 가능 범위는 선택할 API의 현행 약관에 따라 확인해야 한다. 기존 개발자센터 검색 API에는 AI 입력·활용을 제한하는 약관 개정 안내도 있으므로, 뉴스 결과를 챗봇 검색 자료나 학습 데이터로 함께 쓰는 것으로 설계하지 않았다. API HUB의 적용 약관은 별도로 확인해야 한다. [공식 약관 개정 안내가 있는 공지 목록](https://developers.naver.com/notice/?page=1).

이번에는 뉴스 API 가입·키 발급·유료 서비스 신청·실제 뉴스 요청을 수행하지 않았다.

## 다음 작업의 우선순위

1. 현재 코드의 측정 상황·식사 시간대·식품 필드와 기존 준비본의 대응 규칙을 정한다.
2. 일반 지식 답변부터 서버 API와 승인 자료 검색을 설계하고, 개인 기록 요약은 기존 조회·집계 함수를 연결한다.
3. 모델 실행 환경을 확인한 뒤 기준 모델과 비교 모델을 같은 평가 질문으로 시험한다. 한국어 설명·근거 일치·숫자 보존·모름/거절·지연 시간을 확인한다.
4. 기본 모델+검색에서 실패한 사례를 모은 후 추가 학습 필요성을 판단한다. 학습에 쓴 문항을 독립 평가 문항처럼 다시 채점하지 않는다.
5. 뉴스는 별도 목록 기능으로 API HUB 등 선택한 제공처의 조건과 실제 응답을 확인해 연결한다.

자료 준비와 구현 연결이 우선이며, 현재 단계에서 특정 모델을 학습·의료 검증·서비스 연결 완료로 표현하지 않는다.
