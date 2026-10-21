"use client";
import type { GlucoseRecord } from "@/lib/domain";
type MemoryDraft = {
  userId: string;
  values: unknown;
  recordId: string;
  expectedUpdatedAt?: string;
  unknown?: unknown;
  conflict?: boolean;
  storedRecord?: GlucoseRecord | null;
};
// 작성 중인 건강 기록은 저장소에 남기지 않고 현재 탭의 메모리에만 보관해요.
const drafts = new Map<string, MemoryDraft>();
let flashMessage: {
  userId: string;
  message: string;
} | null = null;
export function setFlashMessage(userId: string, message: string) { flashMessage = { userId, message }; }
export function readFlashMessage(userId: string) { return flashMessage?.userId === userId ? flashMessage.message : ""; }
export function clearFlashMessage(userId: string) {
  if (flashMessage?.userId === userId)
    flashMessage = null;
}
export function saveDraft(key: string, draft: MemoryDraft) { drafts.set(key, draft); }
// 계정이 바뀌어도 앞서 로그인한 사람의 작성 내용은 돌려주지 않아요.
export function readDraft(key: string, userId: string) { const draft = drafts.get(key); return draft?.userId === userId ? draft : undefined; }
// 키 없이 호출하는 로그아웃·탈퇴에서는 초안과 일회성 알림을 함께 지워요.
export function clearDraft(key?: string) {
  if (key)
    drafts.delete(key);
  else {
    drafts.clear();
    flashMessage = null;
  }
}
export function retainUserDrafts(userId: string) {
  for (const [key, draft] of drafts)
    if (draft.userId !== userId)
      drafts.delete(key);
}
