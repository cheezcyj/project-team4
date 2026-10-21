"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { signupFields } from "@/lib/account-validation";
import type { AppSession } from "@/lib/domain";
import { api, errorMessage, RequestError } from "@/lib/client/api";
import { PublicFrame } from "@/components/layout/public-frame";
import { InlineError, PageHeading } from "@/components/ui/page-parts";
type SignupResult = {
  status: "confirmation_required";
} | {
  status: "signed_in";
  session: AppSession;
};
export function SignupScreen() {
  const router = useRouter();
  const [values, setValues] = useState({ email: "", password: "", passwordConfirmation: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    api<AppSession>("/api/session").then(session => {
      if (active && session.user)
        router.replace(session.consent === "current" ? "/dashboard" : "/consent");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [router]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // 상태 표시가 바뀌기 전 연속 클릭도 한 번의 가입 요청으로 막아요.
    if (lock.current)
      return;
    const errors = signupFields(values);
    setFields(errors);
    setError("");
    if (Object.keys(errors).length) {
      document.getElementById(`signup-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    lock.current = true;
    setPending(true);
    try {
      const result = await api<SignupResult>("/api/signup", { method: "POST", body: JSON.stringify(values) });
      // 가입이 끝나면 비밀번호 입력값을 화면 메모리에서도 비워요.
      setValues(current => ({ ...current, password: "", passwordConfirmation: "" }));
      if (result.status === "signed_in") {
        router.replace(result.session.consent === "current" ? "/dashboard" : "/consent");
        router.refresh();
      }
      else
        setConfirmation(true);
    }
    catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof RequestError && cause.fields)
        setFields(cause.fields);
    }
    finally {
      lock.current = false;
      setPending(false);
    }
  };
  return <PublicFrame>
    <div className="account-public">
      <PageHeading title="내 계정 만들기" description="본인의 이메일과 비밀번호로 가입해요." />
      {confirmation ? <div className="state-box" role="status">
        <h2>이메일 확인이 필요해요</h2>
        <p>가입 확인 메일이 도착했다면 안내를 따라 주세요. 메일이 오지 않으면 팀 운영자에게 문의해 주세요.</p>
        <Link href="/login">로그인으로 돌아가기</Link>
      </div> : <>
        <p className="message">팀 프로젝트 시연용이에요. 이메일 인증 없이 가입하며, 가상 데이터만 입력해 주세요.</p>
        <form onSubmit={submit} noValidate>
          {([
            { name: "email", label: "이메일", type: "email", complete: "username" },
            { name: "password", label: "비밀번호", type: "password", complete: "new-password" },
            { name: "passwordConfirmation", label: "비밀번호 확인", type: "password", complete: "new-password" },
          ] as const).map(field => <div className="field" key={field.name}>
            <label htmlFor={`signup-${field.name}`}>
              {field.label}
            </label>
            <input
              id={`signup-${field.name}`}
              name={field.name}
              type={field.type}
              autoComplete={field.complete}
              required
              disabled={pending}
              value={values[field.name]}
              maxLength={field.name === "email" ? 254 : 72}
              aria-invalid={Boolean(fields[field.name])}
              aria-describedby={fields[field.name] ? `${field.name}-error` : field.name === "password" ? "password-help" : undefined}
              onChange={event => { setValues(current => ({ ...current, [field.name]: event.target.value })); setFields(current => ({ ...current, [field.name]: "" })); }} />
            {field.name === "password" && <p id="password-help" className="field-hint">12자 이상으로 입력해 주세요. 영문 기준 최대 72자이며, 한글은 더 짧을 수 있어요.</p>}
            {fields[field.name] && <p id={`${field.name}-error`} className="field-error">
              {fields[field.name]}
            </p>}
          </div>)}
          {error && <InlineError>
            {error}
          </InlineError>}
          <button className="button full-width" disabled={pending}>
            {pending ? "가입하는 중" : "회원가입"}
          </button>
        </form>
        <p className="fine-print">이미 가입했나요? <Link href="/login">로그인</Link>
        </p>
      </>}
    </div>
  </PublicFrame>;
}
