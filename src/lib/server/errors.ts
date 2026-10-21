// 화면에 전달해도 되는 문구와 입력 항목 오류만 이 형태에 담아요.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function notFound(): never {
  // 다른 사람의 기록과 없는 기록을 같은 답변으로 처리해 존재 여부도 알려주지 않아요.
  throw new ApiError(404, "NOT_FOUND", "기록을 확인할 수 없어요.");
}

export function noConsent(): never {
  throw new ApiError(
    403,
    "CONSENT_REQUIRED",
    "새 기록을 저장하거나 수정하려면 현재 안내에 동의해 주세요. 기존 기록은 확인하거나 삭제할 수 있어요.",
  );
}

export function unauthorized(): never {
  throw new ApiError(401, "UNAUTHORIZED", "다시 로그인해 주세요.");
}
