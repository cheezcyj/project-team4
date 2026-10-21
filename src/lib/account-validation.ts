// 화면과 서버가 같은 가입 규칙을 사용해요. 비밀번호는 변경하거나 보관하지 않고 검사만 해요.
export function signupFields(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    errors.email = "이메일 주소를 확인해 주세요.";
  }
  // 한글은 한 글자에 여러 바이트를 써요. 글자 수와 저장 방식의 72바이트 한도를 함께 확인해요.
  if (typeof body.password !== "string" || body.password.length < 12 || new TextEncoder().encode(body.password).length > 72 || body.password.includes("\0")) {
    errors.password = "비밀번호는 12자 이상, 영문 기준 72자 이내로 입력해 주세요.";
  }
  if (body.passwordConfirmation !== body.password) errors.passwordConfirmation = "비밀번호가 서로 달라요.";
  return errors;
}

// 로그인 쿠키가 여러 조각으로 나뉜 경우도 찾되, 다른 프로젝트의 쿠키는 지우지 않아요.
export function isProjectAuthCookie(name: string, projectUrl: string): boolean {
  const prefix = `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
  return name === prefix || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}-`);
}
