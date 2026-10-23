# Ollama로 도우미 연결하기

2026-10-23부터 이 PC의 앱 모델 주소를 `http://127.0.0.1:11434/v1`, 모델 이름을 `team4-gemma4-e4b-qat:latest`로 설정했다. 기존 텍스트 GGUF를 Ollama에 가져왔으며 새 다운로드나 재양자화는 하지 않았다. 앱의 질문·검색·출처 검사와 개인 기록 요약 방식은 유지한다.

[실제 연결 평가 결과](research/assistant-supabase-eval/OLLAMA_REPORT.md)에 응답 원문, 요청 수, 남은 내용 보완 항목을 기록했다.

팀의 로컬 화면 시연과 Supabase 개발 평가 설정은 [팀 실행 안내](ASSISTANT_TEAM_SETUP.md)를 따른다.

누락 보완 후 [최종 40문항·첫 요청·팀 시연 확인](research/assistant-eval-replacement40/OLLAMA_REPORT.md)을 마쳤다. 기존 연결 평가에서 남긴 세부 함량 기준 누락을 출처 요약 대체로 보완했다.

## 기존 GGUF 등록

Ollama가 실행된 상태에서 Git에서 제외되는 `.local/` 아래에 `Modelfile`을 만든다. `FROM` 경로만 각 PC의 실제 GGUF 위치로 바꾼다. 사진 입력과 mmproj는 사용하지 않는다.

```text
FROM "C:/path/to/gemma-4-E4B_q4_0-it.gguf"
PARAMETER num_ctx 131072
PARAMETER temperature 0.1
PARAMETER num_predict 512
```

```powershell
ollama create team4-gemma4-e4b-qat:latest -f .local/Modelfile
ollama list
```

이 이름은 프로젝트에서 로컬로 붙인 별칭이다. `ollama pull team4-gemma4-e4b-qat`로 내려받는 공개 모델 이름이 아니다. CLI가 PATH에 없으면 설치된 Windows 실행 파일을 명시한다.

```powershell
$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
& $ollamaExe list
```

이번 원본과 가져온 blob은 5,154,941,280바이트, SHA-256 `676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee`로 일치했다. Ollama 버전은 `0.40.9`다. 원본과 이전 비교용 모델 저장소는 보존했다.

## 앱 설정

기존 Supabase 설정을 유지하면서 `.env.local`의 모델 항목을 설정한다. 아래 값은 로컬 개발용이며 환경 파일은 Git에 올리지 않는다.

```dotenv
ASSISTANT_ENABLED=1
ASSISTANT_MODEL_BASE_URL=http://127.0.0.1:11434/v1
ASSISTANT_MODEL=team4-gemma4-e4b-qat:latest
ASSISTANT_MODEL_API_KEY=
ASSISTANT_MODEL_RESPONSE_FORMAT=text
ASSISTANT_ALLOW_DRAFT_PREVIEW=0
ASSISTANT_SUPABASE_EVAL_USER_IDS=
```

`text`에서도 모델에는 JSON 답변을 요구하고 앱이 JSON·출처 ID를 검증한다. Ollama용 별도 LangChain이나 API 키는 필요하지 않다. 개발 서버는 환경 파일 변경을 다시 읽으며, 프로덕션 서버는 다시 실행해야 한다.

초안 자료의 승인 상태는 그대로다. 기본 Supabase 앱에서는 일반 지식 답변을 차단하고, 별도 동의를 받은 공복 기록 요약은 모델 없이 사용할 수 있다. 일반 답변의 개발 검증은 [가상 계정 전용 평가](ASSISTANT_SUPABASE_EVAL.md)로 실행한다. 모델 연결을 위해 초안 승인을 켜거나 실제 사용자 계정을 평가 허용 목록에 넣지 않는다.

## 로드와 평가

앱과 평가 러너는 모델을 자동으로 다운로드하거나 사전 로드하지 않는다. 실제 평가 전에 다음 빈 프롬프트로 모델을 로드할 수 있다. 이 명령은 GPU 메모리를 사용하지만 질문 답변을 생성하지 않는다.

```powershell
$preloadBody = @{
    model = 'team4-gemma4-e4b-qat:latest'
    prompt = ''
    stream = $false
    keep_alive = '30m'
    options = @{ num_ctx = 131072 }
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:11434/api/generate -Method Post -ContentType 'application/json' -Body $preloadBody
ollama ps
```

```powershell
npm run eval:assistant:supabase -- --run --provider ollama --accounts .local/synthetic-accounts.json --output .local/assistant-ollama-live-01
```

계정 파일은 서비스 동의를 마친 전용 가상 계정 2개를 담아야 한다. 출력은 새 경로로 지정한다. 러너는 실제 Supabase Auth·DB, 브라우저 표시, 일반 질문 4개와 모델을 사용하지 않는 범위 제한 질문 4개를 확인한다. 자료의 의료 검토나 서비스 공개 승인은 별도다.

이전 격리 서버 비교에서는 사전 로드 후에도 첫 실제 질문이 24.39초 걸렸다. 앱의 모델 제한 시간은 30초이며 사전 로드가 첫 질문의 속도를 보장하지 않는다. 요청이 끝나면 Ollama의 로드 유지 시간이 갱신될 수 있으므로, 위 사전 로드가 항상 30분 상주를 보장한다고 해석하지 않는다.

## 현재 실행 설정

이번 연결에서는 사용자 Ollama 앱을 종료·재시작하지 않았고 Windows 사용자 환경변수도 변경하지 않았다. 기본 서버의 실제 엔진 로그는 `n_seq_max=1`, context 131072, flash attention auto다. 이전 11435 비교 서버의 4슬롯 설정과 구분한다. 11434 연결이 4슬롯으로 설정됐다고 기록하지 않는다.

병렬 4슬롯을 사용하려면 사용자가 Ollama를 종료한 후 Windows 사용자 환경변수 `OLLAMA_NUM_PARALLEL=4`를 설정하고 다시 실행할 수 있다. 메모리 사용량은 문맥 크기와 병렬 수의 영향을 받는다. 실제 적용은 모델을 다시 로드한 뒤 엔진 로그로 확인해야 한다. 이번 작업에서 이 변경은 실행하지 않았다.

공식 참고: [GGUF 가져오기](https://docs.ollama.com/import), [OpenAI 호환 API](https://docs.ollama.com/api/openai-compatibility), [Windows 환경변수·로드 유지·병렬 설정](https://docs.ollama.com/faq), [실행 중 모델 조회](https://docs.ollama.com/api/ps).
