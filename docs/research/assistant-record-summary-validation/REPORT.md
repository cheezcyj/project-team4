# 공복 기록 요약의 변경 반영 검증

2026-10-23. 답변 누락 보완을 로컬 커밋 `92b8ce0`에 저장한 뒤, 기록 수정·측정 상황 변경·삭제 후 요약 갱신을 확인했다. 화면 검토에서 다른 탭의 대시보드·기록 목록이 갱신되지 않는 오류도 재현해 보완했다. **로컬 브라우저 시나리오 6개·단위 테스트 69개와 격리 SQL 검사가 통과했다. 이후 별도 Supabase 클라우드 테스트 프로젝트를 이 PC에 연결해 실제 Auth·SSR 쿠키·PostgREST·RLS와 브라우저 변경 흐름의 7개 시나리오 그룹도 통과했다.** 두 환경의 실행과 최초 실패를 아래에 구분한다.

## 확인한 동작

같은 가상 계정을 두 탭에서 사용했다. 한 탭에서 요약을 확인한 뒤 다른 탭에서 기록을 변경했다. 매번 기존 요약이 지워지고 조회 동의가 해제되는지, 다시 동의하고 조회한 수치가 아래와 같은지 확인했다.

| 단계 | 공복 기록 수 | 평균 | 최솟값 | 최댓값 |
| --- | ---: | ---: | ---: | ---: |
| 공복 110·130 입력 | 2 | 120 | 110 | 130 |
| 130을 140으로 수정 | 2 | 125 | 110 | 140 |
| 140의 측정 상황을 공복에서 식전으로 변경 | 1 | 110 | 110 | 110 |
| 식전 기록 삭제 | 1 | 110 | 110 | 110 |
| 마지막 공복 110 기록 삭제 | 0 | null | null | null |

마지막 삭제 후 이전 평균이 남지 않고 기록이 없어 계산하지 않았다는 안내가 표시됐다. 미기록일을 혈당 0으로 처리하지 않았고, 화면에 원본 식사 메모가 노출되지 않았다. 360px 화면에서 가로 넘침도 없었다.

기존 시나리오의 인증·Origin·서비스 동의·요청별 기록 조회 동의·사용자 지정 필드 차단, 본인 공복 기록 집계, 동의 체크 해제 후 늦은 응답 무시, 다른 탭의 기록 추가·로그아웃도 함께 통과했다. 늦은 응답 시나리오 1개는 의도적으로 모의 응답을 사용한다. 나머지는 로컬 demo API·파일 저장소와 브라우저를 연결한 검사다.

## 최초 로컬 실행 결과와 증거

| 검사 | 결과 | 확인 범위 |
| --- | --- | --- |
| 공복 요약 Playwright | 6/6 | 로컬 demo 계정·격리된 가상 데이터 파일 |
| 기본 SQL·RLS | 70개 | 메모리 PostgreSQL인 PGlite, SQL 인증 ID fixture |
| 식사·기록·가져오기 등 SQL | 62개 | 별도 격리 PGlite |
| 계정 삭제 SQL | 18개 | 별도 격리 PGlite |
| lint·타입 검사 | 통과 | 추가한 브라우저 시나리오 포함 |
| 단위 테스트·프로덕션 빌드 | 69개·통과 | 아래 화면 동기화 수정 후 검사 |
| 실제 Supabase Auth·JWT·PostgREST | 미실행 | 해당 환경은 다른 PC에서 실행 중 |

최초 요약 검사에서는 제품 코드 변경 없이 기존 빌드 `SQMvi52oc3B62EhWXnuPq`를 사용했다. 이후 화면 동기화 오류를 보완하고 새 빌드로 아래 추가 확인을 마쳤다. 모델 추론은 실행하지 않았다. 테스트는 이전 화면 증거를 덮어쓰지 않도록 매번 새 출력 경로를 사용했다. 가상 저장 파일은 `.local/e2e/`에 보존된다.

```powershell
npm run test:db
$env:PLAYWRIGHT_BROWSER_CHANNEL='chrome'
npx playwright test --config playwright.summary.config.ts --output .local/새로운-검증-출력경로 --reporter=line
```

브라우저 검사 전 현재 코드의 프로덕션 빌드가 필요하다. 기존 출력 폴더는 재사용하지 않는다. 이 명령은 Supabase 환경을 시험하지 않으며 `playwright.summary.config.ts`가 별도 로컬 demo 서버를 시작한다.

- [관찰한 5단계 실제 집계 응답](runs/20261023-local-mutations/summary-mutations.json)
- [최초 검사: 수치 수정 후 화면](runs/20261023-local-mutations/summary-after-edit-360.png), [최초 검사: 마지막 공복 삭제 후 화면](runs/20261023-local-mutations/summary-after-final-delete-360.png). 이때 도우미는 맞았으나 배경 대시보드에는 이전 기록이 남아 있었다.
- [브라우저 실행 로그](runs/20261023-local-mutations/e2e.log), [SQL 검사 로그](runs/20261023-local-mutations/db.log)
- [실행 조건](runs/20261023-local-mutations/verification.json), [검사 소스](runs/20261023-local-mutations/test-source.txt), [파일 해시](runs/20261023-local-mutations/artifact-manifest.json)

## 추가 발견한 화면 동기화 오류 보완

요약 응답의 수치는 맞았지만 130을 140으로 저장한 뒤에도 기존 대시보드는 130을 표시했다. 마지막 공복 기록을 지운 뒤에도 배경에는 이전 그래프·행이 남았다. 기존 6개 검사는 요약의 수치와 초기화만 확인했으므로 이 배경 표시 오류를 잡지 못했다.

대시보드·기록 목록에 실제 수정 값이 표시되는지 검사를 보탰고, 수정 전 **1개 집중 검사에서 실패를 재현**했다. 원인은 도우미만 기록 변경 알림을 받고, 대시보드·기간별 기록을 읽는 훅은 날짜나 사용자 변경 때만 재조회하는 구조였다.

클라이언트 API에 기존 기록 변경 알림을 구독하는 공통 함수를 추가하고 `useRecords`·`usePeriodData`가 같은 탭 이벤트와 다른 탭의 BroadcastChannel 메시지에 맞춰 재조회하도록 했다. 기존 조회 순서 번호를 유지해 뒤늦은 응답은 무시하고, 화면을 떠나면 구독을 해제한다. 서버 집계·인증·의료 답변·데이터베이스 스키마는 변경하지 않았다.

수정 후 6개 전체 시나리오가 통과했다. 추가 검사에서는 대시보드와 통합 일지에 140이 표시되고 130은 사라지는지, 측정 상황이 식전으로 바뀌는지, 삭제한 행이 사라지는지, 마지막 공복 기록 삭제 후 대시보드가 빈 상태가 되는지 확인했다. 요약의 5단계 통계도 위 표와 동일했다.

- [수정 전 집중 검사 실패 로그](runs/20261023-synchronized/stale-before.log), [수정 후 전체 검사 로그](runs/20261023-synchronized/e2e.log)
- [동기화 수정 후 수치 화면](runs/20261023-synchronized/summary-after-edit-360.png), [마지막 삭제 후 빈 대시보드](runs/20261023-synchronized/summary-after-final-delete-360.png)
- [수정 후 실제 집계 응답](runs/20261023-synchronized/summary-mutations.json), [실행 조건·빌드·소스 해시](runs/20261023-synchronized/verification.json)

기간별 조회 훅을 사용하는 기록 목록을 함께 확인했다. 달력·기간 비교·리포트의 모든 조합을 개별 검증한 것은 아니다. 실제 Supabase 브라우저 경로와 구분한다.

## 최초 준비한 실제 Supabase 확인 절차

실행 전제는 저장소 코드와 마이그레이션이 맞는 **팀 개발용 프로젝트**, 기록이 없는 전용 가상 테스트 계정 A·B, 별도 브라우저 프로필 두 개다. 이 문서의 숫자는 가상 검사값이다. 기존 이용자 기록을 지워 초기 상태를 만들지 않고 새 테스트 계정을 사용한다.

기존 연결 정보는 그 PC의 `.env.local`에 유지한다. 앱이 읽는 설정 이름은 아래와 같다. 값은 채팅이나 검증 기록에 복사하지 않는다.

```dotenv
APP_MODE=supabase
SUPABASE_URL=<기존 팀 개발 프로젝트 URL>
SUPABASE_PUBLISHABLE_KEY=<기존 공개용 키 또는 anon 키>
ASSISTANT_ENABLED=1
ASSISTANT_ALLOW_DRAFT_PREVIEW=0
```

일반 건강정보 모델 연결 없이 공복 기록 요약을 확인할 수 있다. 개발 서버는 `npm run dev`로 실행하고 해당 PC에서 `http://127.0.0.1:3000`에 접속한다. `start:demo`는 실제 Supabase 검증용 명령이 아니다. 앱의 요청 처리에서 관리자 키를 사용하지 않는다.

| 순서 | 작업 | 기대 결과 |
| --- | --- | --- |
| 1 | 비로그인 상태로 요약 POST 요청 | HTTP 401 `UNAUTHORIZED` |
| 2 | 새 A 계정 로그인, 서비스 안내 동의 전 요약 요청 | HTTP 403 `RECORD_CONSENT_REQUIRED` |
| 3 | 서비스 동의 후 요청별 기록 조회 체크를 하지 않음 | 버튼 비활성. API에 조회 동의가 없는 요청은 403 `RECORD_ACCESS_CONSENT_REQUIRED` |
| 4 | A에 최근 7일 안의 공복 110·130, B에 공복 250을 입력 | A의 요약은 2건·평균 120·최소 110·최대 130. B 값이 섞이지 않음 |
| 5 | A를 같은 브라우저의 두 탭에서 사용, 다른 탭에서 수치·상황·삭제 변경 | 위 5단계 수치와 동일. 변경 시 기존 요약·동의가 지워짐 |
| 6 | A에서 요약을 띄운 뒤 다른 탭에서 로그아웃 | 이전 개인 요약이 지워지고 로그인 상태가 갱신됨 |
| 7 | A에서 조회 동의 체크 해제, 닫았다 다시 열기 | 요약이 사라지고 동의 체크가 해제됨 |
| 8 | 요약 요청에 `user_id` 등 지정 필드 추가 | HTTP 422 `INVALID_INPUT`, 다른 사용자 기록을 조회하지 않음 |
| 9 | 종료 후 이번 검사에서 생성한 B 가상 기록 삭제 | 다른 계정·공통 자료를 변경하지 않음 |

API 상태를 확인할 때는 해당 앱 화면의 개발자 도구에서 다음 함수를 정의하고 호출할 수 있다. 키·비밀번호·로그인 쿠키를 문서에 넣을 필요가 없다.

```javascript
async function checkSummary(body) {
  const response = await fetch('/api/assistant/records-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
await checkSummary({ allow_record_access: true });
// 서비스 동의 후 각각 별도 확인:
await checkSummary({});
await checkSummary({ allow_record_access: true, user_id: 'forbidden' });
```

체크 해제는 이번 요약의 조회 허용을 철회하는 동작이다. DB에 저장한 서비스 이용 동의를 삭제하거나 과거 조회를 되돌리는 기능으로 해석하지 않는다. 이 표는 최초에 다른 PC용으로 준비한 절차다. 이후 별도 클라우드 프로젝트에서 확인한 항목과 아직 별도인 범위는 아래에 기록한다.

실제 확인 후에는 앱 커밋·실행 모드·마이그레이션 상태, 각 단계의 통과/실패와 실제 통계, 브라우저 화면을 기록하면 된다. 계정 식별자·키·토큰·비밀번호는 결과에 포함하지 않는다.

## 실제 Supabase 연결 검증 추가

사용자가 만든 별도 테스트 프로젝트의 연결값을 이 PC의 `.env.local`에 설정했다. 기존 모델 연결 설정은 보존하고 초안 자료 미리보기는 껐다. 앱은 루프백 3005번 포트의 Supabase 모드이며 기존 3000번 포트의 demo 서버와 구분한다. 연결키는 publishable key이고 관리자 키는 사용하지 않는다.

사용자가 SQL을 직접 실행하던 중 `meal_slot already exists` 오류를 보고했다. 추가 초기화 SQL을 실행하지 않고 별도 읽기 전용 쿼리로 확인했다. 표 10개 모두 RLS와 강제 적용이 켜져 있고 접근 정책 15개, 식사 관련 제약조건 2개, 기본 식품 8개·정책 자료 3개, 계정 삭제·식사 저장 함수 및 `PT409` 처리가 있었다. 주요 구성이 이미 존재하는 상태의 재실행 오류로 확인했으며 기존 표나 열을 지우지 않았다. SQL 마이그레이션 원본도 수정하지 않았다.

새 가상 계정 A·B를 대시보드의 사용자 생성 기능으로 만들고 자동 확인을 사용했다. 확인 메일이나 초대 메일은 보내지 않았다. 화면의 `.invalid` 이메일은 이번 검사에서 생성한 가상 식별자이며 실제 연락처가 아니다. 실제 사용자 자료는 사용하지 않았다. 앱의 이메일·비밀번호 로그인과 SSR 쿠키를 거쳐 기록을 만들고, 별도로 일반 사용자 JWT와 publishable key만 사용하는 직접 PostgREST 요청도 검사했다.

| 최종 시나리오 그룹 | 결과 |
| --- | --- |
| 실제 Supabase 모드와 비로그인 요약 차단 | 통과 |
| 두 계정 Auth 로그인·SSR 쿠키·서비스 동의 | 통과. 미동의 403은 첫 실행에 보존 |
| 요청별 조회 동의·사용자 지정 필드·다른 Origin 차단 | 통과 |
| 실제 기록 생성·앱 API의 계정 분리 | 통과 |
| 직접 PostgREST에서 타인 기록 조회·수정·삭제·추가 차단 | 통과. 타인 기록은 250으로 유지 |
| 360px 두 탭의 5단계 요약·대시보드 변경 반영 | 통과. 최초 120 → 수정 125 → 상황 변경 110 → 식전 삭제 110 → 마지막 공복 삭제 null |
| 다른 탭 로그아웃 시 인증 화면 초기화 | 통과 |

SQL·API·브라우저를 모의 응답으로 대체하지 않았다. 모델 호출 없이 서버 계산 기능을 검사했다. 시나리오 그룹 7개는 40문항 모델 평가나 단위 테스트 개수와 다른 단위다. 검사마다 만든 혈당 기록은 모두 정리했으며, 가상 계정과 서비스 동의는 재검증용으로 남아 있다.

최초 Turbopack 개발 서버에서는 화면이 반복 새로고침되어 브라우저 검사가 멈췄다. Webpack 개발 서버에서는 정상 화면을 확인했다. 새로고침의 근본 원인은 확정하지 않았다. 첫 Webpack 검사에서는 두 단계 통계까지 맞았으나 측정 상황 변경 후 도우미 재열기가 실패했다. 변경 알림과 대시보드 조회가 끝나기 전에 도우미를 여는 검사 순서의 영향을 확인하고, 변경된 행·삭제 결과가 화면에 표시된 뒤 다시 열도록 검사기를 보완했다. 제품 코드는 추가 수정하지 않았다. 실패 결과를 덮어쓰지 않고 마지막 전체 실행에서 7개 그룹이 통과한 것을 별도로 보존했다.

```powershell
npm run dev -- --webpack --port 3005
```

- [최종 실제 DB 결과와 5단계 통계](runs/20261023-hosted-supabase/hosted-validation.json), [최종 실행 로그](runs/20261023-hosted-supabase/hosted-validation-webpack.log)
- [최초 실행과 서비스 미동의 차단](runs/20261023-hosted-supabase/hosted-validation-initial.json), [첫 Webpack 검사 중단 결과](runs/20261023-hosted-supabase/hosted-validation-webpack-initial.json)
- [수정 후 실제 요약 화면](runs/20261023-hosted-supabase/hosted-summary-after-edit-360.png), [마지막 삭제 후 빈 요약](runs/20261023-hosted-supabase/hosted-summary-empty-360.png)
- [Turbopack의 반복 화면 이동](runs/20261023-hosted-supabase/dev-stability.json), [Webpack 화면 준비 확인](runs/20261023-hosted-supabase/dev-stability-webpack.json)
- [실제 DB 읽기 전용 조회문](runs/20261023-hosted-supabase/inspect-test-project.sql), [기본 자료·정책 조회문](runs/20261023-hosted-supabase/inspect-seeds.sql)
- [Site URL 저장 후 재조회](runs/20261023-hosted-supabase/site-url-check.json)
- [실행 조건·앱 소스·마이그레이션 해시](runs/20261023-hosted-supabase/verification.json), [검사기 소스 스냅샷](runs/20261023-hosted-supabase/test-source.mjs), [파일 해시](runs/20261023-hosted-supabase/artifact-manifest.json)

이 결과는 이 PC의 Webpack 개발 서버와 별도 클라우드 프로젝트의 조합이다. Authentication → URL Configuration에서 Site URL을 `http://localhost:3000`에서 `http://127.0.0.1:3005`로 바꾸어 저장하고, 페이지를 새로 불러온 뒤 값이 유지되는 것을 확인했다. 메일을 통한 실제 회원가입·확인 메일 수신과 복귀 흐름, 운영 HTTPS 배포, 달력·리포트·식사·가져오기의 모든 조합은 검사하지 않았다. 실제 Supabase에서 체크 해제 후 늦은 응답을 무시하는 경로도 이번 추가 시나리오에 포함하지 않았으며 앞선 demo 검사의 범위로 남는다. 일반 건강정보 모델 답변의 자료 승인 조건은 유지했고, Supabase 모드에서 초안 자료로 모델 답변을 활성화하지 않았다. 연결값·비밀번호와 원본 대시보드 캡처는 로컬에만 보관한다.
