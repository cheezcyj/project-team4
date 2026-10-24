# 팀에서 도우미 실행하기

이 문서는 기존 팀 초안 자료를 사용하는 로컬 실험과 Supabase 개발 평가를 설명합니다. 공개 건강자료 및 Qwen 공통 안내문 재사용은 [로컬 도우미 연결 안내](LOCAL_ASSISTANT.md)를 참고합니다. 모델 서버를 바꿔도 개인 기록을 모델에 보내는 기능은 추가하지 않습니다.

## 준비할 것

- Node.js 22.9 이상과 `npm ci`로 설치한 프로젝트 의존성.
- Next.js 서버가 실행되는 **같은 PC**의 Ollama. 현재 연결부는 loopback만 허용하므로, 다른 PC의 Ollama에 `127.0.0.1`로 연결할 수 없다.
- [Ollama 연결 안내](ASSISTANT_OLLAMA.md)에 따라 등록한 `team4-gemma4-e4b-qat:latest`. 기존 GGUF를 가져오는 로컬 별칭이며 공개 다운로드 태그가 아니다.
- `.env.local`은 각자 준비한다. 저장소의 `.env.example`을 기준으로 모델 설정을 채우고, Supabase 개발 평가에만 해당 프로젝트 URL·publishable key를 추가한다.

## 가상 계정으로 화면 시연

아래 명령은 이 PC 안에서만 접속하는 demo 모드다. Supabase 계정·DB가 없어도 동작한다. 기존 서버와 겹치지 않도록 예시는 3007을 사용한다.

```powershell
npm ci
npm run build
$env:PORT='3007'
$env:ASSISTANT_ENABLED='1'
$env:ASSISTANT_MODEL_BASE_URL='http://127.0.0.1:11434/v1'
$env:ASSISTANT_MODEL='team4-gemma4-e4b-qat:latest'
$env:ASSISTANT_MODEL_RESPONSE_FORMAT='text'
$env:ASSISTANT_ALLOW_DRAFT_PREVIEW='1'
node --env-file-if-exists=.env.local scripts/run-demo.mjs --production
```

`http://127.0.0.1:3007`에서 가상 계정 A로 로그인한다. 도우미의 개발용 미리보기 표시와 질문별 AI 처리 동의를 확인하고 `당화혈색소가 무엇인가요?`를 전송한다. 답변과 출처가 표시되어야 한다. 공복 요약은 별도 기록 조회 동의를 받으며 최근 7일 공복 기록만 계산한다. 두 기능의 동의는 서로 대신하지 않는다.

첫 요청에는 모델 로드 시간이 포함될 수 있다. [사전 로드 명령](ASSISTANT_OLLAMA.md#로드와-평가)으로 준비할 수 있으며, 모델이 내려가면 이후 요청에 로드 시간이 다시 발생할 수 있다. 앱의 모델 제한 시간은 기본 45초이며 `ASSISTANT_MODEL_TIMEOUT_MS`로 1~90초 범위에서 조절합니다.

## 실제 Supabase로 연결 확인

일반 개발 설정은 `APP_MODE=supabase`, `ASSISTANT_ALLOW_DRAFT_PREVIEW=0`, 빈 `ASSISTANT_SUPABASE_EVAL_USER_IDS`로 유지한다. 이 상태에서는 공개 건강자료 기반 답변을 사용하고 팀 초안 자료는 차단합니다. 본인 공복 기록 요약은 별도 동의 후 사용할 수 있습니다. 기존 초안 평가 도구를 실행할 때는 제어 앱과 평가 터미널에 `ASSISTANT_PUBLIC_SOURCES_ENABLED=0`을 지정해 공개 자료 요청을 끕니다.

일반 답변까지 확인하려면 [Supabase 평가 안내](ASSISTANT_SUPABASE_EVAL.md)의 전용 `.invalid` 가상 계정 2개를 준비하고 `--provider ollama`로 평가한다. 러너가 임시 개발 서버의 계정 A만 허용하고, 종료 시 자신이 만든 기록과 서버만 정리한다. 실제 사용자 계정이나 건강정보를 평가에 사용하지 않는다.

## 자료 상태와 완료 범위

| 항목 | 현재 상태 |
| --- | --- |
| 일반 지식 | 대체 FAQ 13개 검색, 현재 질문·공개 요약과 같은 방의 최근 일반 대화 일부만 모델에 전달, 답변·출처 ID 검사 |
| 대화 보관 | 별도 저장·AI 처리 동의, 계정별 방 목록·새 채팅·삭제, 닫기·재로그인 후 복원 |
| 개인 기록 | 별도 조회·저장 동의 후 최근 7일 공복 요약을 방에 보관. 과거 요약은 유지하고 새 요청에서 재계산. 저장된 요약은 AI 이력에서 제외 |
| 자유 질문 기반 기록 조회 | 미지원. 요약 버튼으로 안내하며 어제·오늘 및 지난달 비교를 수행하지 않음 |
| 음식명으로 영양 DB 조회 | 미연결. 제품별 영양값을 조회했다고 답하지 않음 |
| 자료집 | `replacement-v1-draft-3`, `runtime_publishable=false`, 내용·팀·서비스 공개 승인 미완료 |
| 시연과 공개 | 로컬 초안 시연은 연결·동작 검증용. 자료 검토와 공개 승인을 대신하지 않음 |

팀에서 검토할 대상은 현재 FAQ의 설명·필수 조건, 출처와 재사용 조건, 지원·미지원 기능 표시다. 승인 플래그를 켜는 것만으로 검토를 완료했다고 기록하지 않는다. 운영 공개·실제 이용자 대상 제공은 이번 로컬 시연 검증의 완료 범위에 포함하지 않는다.

기존 [Supabase 결과](research/assistant-supabase-eval/REPORT.md), [Ollama 연결 결과](research/assistant-supabase-eval/OLLAMA_REPORT.md)에는 실행 조건과 검증 한계를 구분했다. 이 PC의 재현 결과는 다른 팀 PC에서 실행을 확인했다는 뜻이 아니다.

40문항 재평가 방법은 [문항 안내](research/assistant-eval-replacement40/QUESTIONS.md)를 따른다. 별도 경로에 빌드했다면 러너의 `--build-dir .local/빌드폴더`로 실제 산출물을 지정한다. 기본값은 `.next`이며 작업 폴더 안의 `BUILD_ID`가 있는 디렉터리만 허용한다. 기록한 빌드 ID가 실행 중 서버의 원격 증명을 뜻하지는 않는다.
