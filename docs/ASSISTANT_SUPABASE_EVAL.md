# 로컬 Supabase 챗봇 평가

실제 Supabase 인증·기록 조회와 로컬 모델의 일반 지식 답변을 같은 화면에서 확인한다. 개인 기록은 별도 동의를 받는 서버 계산 도구로 처리하고, 모델에는 현재 질문과 공개 지식만 전달한다. 자유 질문으로 개인 기록을 조회하거나 개인 수치를 해석하는 기능은 아직 지원하지 않는다.

기본 앱의 초안 차단을 유지하고 임시 평가 앱을 별도로 실행한다. 자료집의 승인 상태를 변경하지 않는다. [2026-10-23 실행 결과](research/assistant-supabase-eval/REPORT.md)에 실제 응답·요청 수·검증 한계를 남겼다.

Ollama 누락 보완 후에도 실제 Supabase의 8문항·기록 갱신·경계 검사를 재확인했다. [최종 결과](research/assistant-eval-replacement40/OLLAMA_REPORT.md)에 요청 수·회귀 검사·정리 상태를 구분했다.

## 적용 조건

Supabase에서 초안 자료를 사용하려면 아래 조건을 모두 충족해야 한다.

- `ASSISTANT_ALLOW_DRAFT_PREVIEW=1`과 `NODE_ENV=development`.
- 요청 URL과 Host가 모두 literal loopback이고 포트가 일치함. Origin이 있으면 Host 기준 origin과 일치하며 cross-site 요청이 아님. 전달된 proxy 헤더는 허용 근거로 사용하지 않음.
- Supabase에서 인증한 사용자이며 현재 서비스 동의가 있음.
- 사용자 이메일이 `.invalid`로 끝나는 가상 계정임.
- 검증된 사용자 UUID가 서버 전용 `ASSISTANT_SUPABASE_EVAL_USER_IDS` 목록에 있음.

별도로 `ASSISTANT_ENABLED=1`과 유효한 모델 연결 설정이 필요하다. POST의 기존 인증·Origin·질문별 AI 처리 동의 검사는 유지한다. 사용자 본문에 `user_id`나 `loopbackRequest`를 넣어 평가 권한을 만들 수 없다. 프로덕션에서는 평가 옵션을 켜도 초안 예외를 적용하지 않는다. 이 개발 서버는 `127.0.0.1`에만 바인딩하며 외부 터널이나 공개 프록시로 노출하지 않는다.

일상 개발용 `.env.local`은 `ASSISTANT_ALLOW_DRAFT_PREVIEW=0`, 평가 사용자 목록은 빈 값으로 둔다. 아래 러너는 자식 프로세스에만 평가 설정을 넣으며 `.env.local`을 수정하지 않는다.

## 준비

1. 기본 Supabase 앱을 `http://127.0.0.1:3005`에서 실행한다. 기본 앱의 일반 초안 답변은 비활성화되어 있어야 한다.
2. 서비스 동의를 완료한 전용 가상 계정 2개를 준비한다. 최근 7일 공복 기록이 없어야 한다. 기존 기록이 있으면 러너는 삭제하지 않고 중단한다.
3. Git에서 제외되는 `.local/` 아래에 아래 형태의 계정 파일을 준비한다. 실제 계정 비밀번호·키를 문서나 채팅에 적지 않는다.
4. `.env.local`에 실제 로컬 모델 주소·모델 ID·응답 형식을 설정한다. 모의 평가에도 이 설정 형식은 필요하지만 모델 서버를 호출하지 않는다.
5. `3006`과 `11481` 포트를 비워 둔다. 같은 평가를 동시에 실행하지 않는다. 이 PC는 Chrome 채널을 사용하며 다른 환경은 `PLAYWRIGHT_BROWSER_CHANNEL`로 설치된 채널을 지정한다.

```json
[
  { "label": "A", "email": "assistant-a@example.invalid", "password": "LOCAL_ONLY" },
  { "label": "B", "email": "assistant-b@example.invalid", "password": "LOCAL_ONLY" }
]
```

실제 모델 평가는 해당 서버에 모델이 이미 로드되어 있어야 한다. `--provider ollama`는 `/api/ps`와 `/api/version`, 기본값 `--provider lmstudio`는 `/api/v1/models`의 로드된 인스턴스를 확인한다. 러너는 모델을 다운로드·로드·언로드하지 않는다. Ollama 준비는 [연결 안내](ASSISTANT_OLLAMA.md)를 참고한다.

## 실행

인자 없이 실행하면 안내만 표시하며 인증·DB 변경·추론은 하지 않는다.

```powershell
npm run eval:assistant:supabase
```

먼저 실제 Supabase + 모의 모델로 흐름을 확인한다. 출력 경로는 존재하지 않는 새 폴더여야 한다.

```powershell
npm run eval:assistant:supabase -- --run --mock-model --accounts .local/synthetic-accounts.json --output .local/assistant-mock-01
```

모델을 로드한 뒤 실제 추론을 실행한다.

```powershell
npm run eval:assistant:supabase -- --run --accounts .local/synthetic-accounts.json --output .local/assistant-live-01
```

Ollama를 사용할 때는 위 명령에 `--provider ollama`를 추가한다. 평가 전후 모델 이름·digest·context·VRAM 크기·버전이 같은지 확인하며, 요청마다 갱신되는 만료 시각은 비교하지 않는다. 병렬 슬롯 수와 flash attention은 `/api/ps`에서 확인할 수 없으므로 이 메타데이터 검사만으로 판정하지 않는다.

기본 앱 주소는 `--control-url http://127.0.0.1:3005`로 지정할 수 있다. 계정·출력 경로는 작업 폴더의 `.local/` 내부만 허용한다.

## 러너가 확인하는 내용

- 기본 앱의 초안 답변 차단, 평가 앱에서 허용한 계정 A만 미리보기 사용.
- 비로그인·AI 처리 미동의·다른 계정 지정·본문 권한 위조·다른 Origin·기록 조회 미동의 거절.
- A의 공복 기록 110·130, B의 250을 생성하고 A의 요약이 2건/평균 120/최소 110/최대 130인지 확인. B의 기록은 A로 직접 조회해도 404.
- 360px 실제 브라우저에서 기록 요약과 첫 일반 질문 답변 표시. 나머지 질문은 실제 API로 확인.
- 일반 질문 4개·개인 기록 질문 2개·치료 변경 질문 1개·근거 밖 질문 1개의 결과 형태와 출처 검사.
- 다른 탭에서 130→140 수정 후 이전 도우미 화면 초기화 및 평균 125 재계산.
- 공급자 요청 본문에 질문·선택한 공개 지식만 있는지 검사하고, 계정 ID·이메일·생성 기록 ID·시험 메모가 있으면 모델 전달 전에 차단.
- 종료 시 러너가 만든 기록 3개만 삭제하고, 자신이 시작한 임시 앱·프록시를 종료. 계정과 기존 데이터는 보존.

`run.json`, `plan.json`, `provider-audit.json`, 두 요약 JSON, 360px 화면과 서버 로그를 출력한다. 서버 로그에는 가상 기록 UUID가 포함될 수 있으므로 원본은 `.local/`에 보관한다. 공유할 때 환경 파일·계정 파일·쿠키·인증 헤더를 포함하지 않는다. 프로세스 강제 종료나 네트워크 단절 시 `run.json`의 `cleanup`과 계정 기록을 확인해야 한다.

러너 자체의 모델 재시도는 없다. 앱의 기존 모델 어댑터는 특정 LM Studio 엔진 오류만 한 번 재시도한다. 평가 결과에서는 HTTP 시도 수, 성공한 생성 응답 수, 자료 요약으로 보충된 최종 답변 수를 구분한다. 이 평가는 의료 검토·서비스 공개 승인·독립 품질 검증을 대신하지 않는다.
