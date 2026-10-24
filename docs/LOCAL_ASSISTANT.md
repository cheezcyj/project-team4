# 로컬 도우미 연결과 비교 실험

운영 서버 계정이나 DB 없이 각자의 PC에서 실행합니다. 모델 파일·인증 값·실험 데이터는 공유하지 않습니다. 기본 화면과 공복 기록 요약은 AI 모델 없이 `npm run dev:demo`로 실험할 수 있습니다.

## 1. 공개 자료와 팀 초안 선택

| 설정 | 자료 | 인터넷 |
|---|---|---|
| `ASSISTANT_ALLOW_DRAFT_PREVIEW=0` | MedlinePlus 공개 건강 주제 요약 | 최초 주제 조회 시 필요 |
| `ASSISTANT_ALLOW_DRAFT_PREVIEW=1` | 기존 팀 초안 FAQ·검색·조건 | 자료 검색 자체에는 필요 없음 |

두 경로 모두 기존 한국어 안내문, 의료 안전 경계, 출처 ID 검사와 조건 보완을 사용합니다. 공개 자료 조회가 실패해도 팀 초안으로 조용히 대체하지 않습니다. 기존 자료집과 평가 도구를 삭제하거나 승인 상태를 변경하지 않습니다.

기존 Supabase 초안 평가 도구를 실행할 때는 제어 앱과 평가 터미널 모두 `ASSISTANT_PUBLIC_SOURCES_ENABLED=0`으로 설정합니다. 그러면 초안 접근 권한이 없는 계정이 공개 자료 경로로 넘어가지 않아 기존 평가 기준을 유지합니다. 일반 공개 자료 실험에서는 이 값을 `1`로 둡니다.

공개 자료 경로는 [MedlinePlus Web Service](https://medlineplus.gov/about/developers/webservices/)의 검색 결과 중 기관·정확한 주제·URL이 일치하는 `FullSummary`만 사용합니다. 질문 원문 대신 정해진 영어 건강 주제를 검색합니다. 사용자 질문, 대화 이력, 계정 식별자와 프로필은 자료 제공처에 전달하지 않습니다. 현재 주제 결과는 12시간 동안 서버 메모리에서 재사용하며 서버 재시작 시 새로 가져옵니다.

[공식 이용조건](https://medlineplus.gov/about/using/usingcontent/)은 건강 주제 요약을 공개 영역 자료로 안내하지만 사이트의 모든 콘텐츠가 같은 조건은 아닙니다. 이 연결은 백과사전, 약물 설명, 사진, 외부 링크의 기사와 검색 결과 발췌를 근거로 사용하지 않습니다. 출처 문구 `Source: MedlinePlus, National Library of Medicine`, 원문과 이용조건 링크를 표시합니다. 한국어 답변은 로컬 모델의 설명이며 원문 기관의 승인·공식 번역을 뜻하지 않습니다.

## 2. 모델과 실행 파일 준비

1. [llama.cpp 공식 배포](https://github.com/ggml-org/llama.cpp/releases)에서 자신의 운영체제용 실행 파일을 받습니다. Windows CPU 패키지는 `llama-server.exe`와 동봉 DLL을 함께 둡니다. 확인한 버전은 `b11669`입니다.
2. 텍스트 GGUF 모델을 준비합니다. 동일 구성 비교에는 [Qwen3.5 2B의 Q4_K_M 파일](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/tree/main)을 사용할 수 있습니다. 원본은 [Qwen/Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B)이며 원본·해당 변환 저장소는 Apache-2.0으로 표시되어 있습니다. 모델을 다시 배포할 때는 해당 파일의 라이선스와 고지를 별도로 확인합니다.
3. 다운로드 파일은 `.local/` 아래 또는 저장소 밖에 둡니다. 이 저장소는 모델과 실행 파일을 포함하지 않으며 자동 다운로드도 하지 않습니다.

최신 버전이나 다른 GGUF가 같은 동작을 보장하지는 않습니다. 실행기는 필요한 템플릿·토큰화·캐시 저장/복원 기능을 실제로 확인하며, 지원하지 않는 경우 시작을 중단합니다. 이미지 입력은 사용하지 않으므로 이 실행에는 시각 모델 파일이 필요하지 않습니다.

## 3. 실행

PowerShell 터미널 1:

```powershell
$llamaFile = Read-Host "llama-server 실행 파일 경로"
$modelFile = Read-Host "GGUF 모델 파일 경로"
npm run assistant:model -- --binary "$llamaFile" --model "$modelFile"
```

macOS·Linux 터미널 1:

```sh
printf 'llama-server 실행 파일 경로: '; read -r llama_file
printf 'GGUF 모델 파일 경로: '; read -r model_file
npm run assistant:model -- --binary "$llama_file" --model "$model_file"
```

준비 완료 메시지 후 터미널 2:

```sh
npm run dev:assistant
```

[로컬 앱](http://127.0.0.1:3000)에서 가상 계정을 선택하고 동의합니다. 최적화된 앱은 `npm run build` 후 `npm run start:assistant`로 실행합니다. 소스를 바꾸면 다시 빌드합니다.

실행기는 `.local/assistant-model/connection.env`를 생성합니다. 이 파일에는 이 PC용 모델 인증 값이 있으므로 전달하거나 커밋하지 않습니다. 기존 `.env.local`과 실험 데이터는 수정하지 않습니다. `LLAMA_SERVER_PATH`, `ASSISTANT_GGUF_PATH`를 본인의 `.env.local`에 넣으면 경로 입력을 생략할 수 있습니다. 터미널에 이미 설정된 환경변수가 환경파일보다 우선합니다.

팀 초안 비교는 앱 터미널에서 다음처럼 명시합니다.

```powershell
$env:ASSISTANT_ALLOW_DRAFT_PREVIEW = "1"
npm run dev:assistant
```

공개 자료로 돌아갈 때는 서버를 종료한 후 `ASSISTANT_ALLOW_DRAFT_PREVIEW="0"`, `ASSISTANT_PUBLIC_SOURCES_ENABLED="1"`로 변경하고 다시 실행합니다. macOS·Linux는 `ASSISTANT_ALLOW_DRAFT_PREVIEW=1 npm run dev:assistant`를 사용합니다. 새 실험 데이터는 `DEMO_DATA_FILE=.local/experiments/experiment-01.json`처럼 새 파일을 지정합니다. 기존 기록은 삭제되지 않습니다.

## 4. 무엇을 비교하나요?

| 실험 | 확인할 내용 |
|---|---|
| `당화혈색소가 무엇인가요?` → `그 검사는 어떤 기간을 보여주나요?` | 새 근거로 답변하며 같은 방에 대화가 이어짐 |
| 공개 자료 설정과 팀 초안 설정을 바꿔 같은 질문 | 출처·초안 표시·자료 범위의 차이 |
| X로 닫기, 새로고침, 가상 계정 재선택 | 저장된 대화 복원 |
| 새로운 가상 계정으로 접속 | 다른 계정의 방이 보이지 않음 |
| 모델 중지 후 질문 | 무한 대기 없이 연결 오류 처리 |
| 공복 기록 요약 | 별도 동의 후 계산하며 개인 요약을 모델에 보내지 않음 |

같은 질문에서 새 주제 단어를 명시하면 기존 주제보다 우선할 수 있습니다. 연결 속도를 비교할 때는 같은 모델·질문·출처 설정·대화 길이로 비교하고, 초기 준비 시간과 실제 답변 시간을 구분합니다. 기존 답변을 통째로 재전송하는 응답 캐시는 사용하지 않습니다.

`src/lib/assistant/model.ts`의 공통 안내문을 수정하면 모델 실행기도 종료하고 다시 시작해 새 안내문을 준비합니다. 앱만 다시 실행한 상태에서 안내문이 다르면 이전 공통 캐시를 사용하지 않고 전체 입력을 새로 처리합니다.

## 5. 속도와 개인정보 처리

앱 → 로컬 연결부 → 로컬 모델 순서로 요청합니다. 연결부는 기존 공통 안내문만 미리 처리해 저장하고, 매 요청 전에 그 상태만 복원합니다. 질문·이력·현재 자료는 새로 처리하며 응답·실패·취소 후 임시 계산 상태를 지웁니다. 모델 계산 구간이 끝날 때까지 정리와 다음 요청이 기다릴 수 있습니다. 정리를 확인하지 못하면 다음 요청을 받지 않습니다.

동시에 한 개의 모델 요청을 처리합니다. 다른 요청은 대기열에 쌓지 않고 연결 오류를 반환하므로 진행 중인 답변이 끝난 뒤 다시 시도합니다. 모델과 연결부는 `127.0.0.1`에만 열고 인증 값을 사용합니다. [실행기 공식 캐시 문서](https://github.com/ggml-org/llama.cpp/blob/620d2225c/tools/server/README.md)의 저장·복원·삭제 기능을 이용합니다.

원래 Supabase·가상 계정의 채팅 기록은 유지됩니다. 임시 모델 상태 삭제와 대화방 삭제는 별도 동작입니다. 모델 출력은 기존 앱의 출처·형식·안전 검사 후 표시됩니다. 개인 정보는 실험 질문에 쓰지 않습니다.

## 6. 문제 해결

| 상황 | 조치 |
|---|---|
| 포트가 이미 사용 중 | 기존 서버를 확인하거나 `--port 11482 --upstream-port 11483` 사용 후 앱 재시작 |
| 모델 연결 파일이 없다는 오류 | 터미널 1에서 모델 준비 완료 후 앱 실행 |
| 실행 파일·GGUF를 찾지 못함 | 공백이 있는 경로를 따옴표로 감싸고 실제 파일 지정 |
| 모델이 시작 직후 종료됨 | `.local/assistant-model/runtime.log`에서 DLL·버전·메모리 확인 |
| 답변이 오래 걸림 | CPU·GPU 지원, 자료·대화 길이, 다른 실행 작업 확인. 모델 대기 한도는 최대 90초 |
| 공개 자료를 불러오지 못함 | 인터넷 연결 확인. 팀 초안은 명시적으로 선택해야 함 |
| 연결부가 안전한 정리에 실패함 | 앱 요청을 멈추고 모델 실행기를 다시 시작 |

기본은 CPU 실행입니다. 다른 설정은 `npm run assistant:model -- --help`로 확인합니다. GPU용 실행 파일이 준비된 경우 `--gpu-layers auto`를 선택할 수 있지만 PC별 GPU 동작은 별도 확인이 필요합니다. 기존 Ollama/Gemma 직접 연결은 [Ollama 안내](ASSISTANT_OLLAMA.md)를 계속 사용할 수 있으며 이 캐시 연결부와 별도입니다.
