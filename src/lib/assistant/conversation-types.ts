import type { AssistantAnswer } from "./types";

export const ASSISTANT_CHAT_NOTICE_VERSION = "assistant-chat-v1";
export const MAX_ROOMS = 50;
export const MAX_TURNS = 100;
export const STALE_TURN_MS = 180_000;
export const ASSISTANT_SUMMARY_QUESTION = "최근 7일 공복 혈당 기록 요약";

export type AssistantTurn = {
  id: string;
  question: string;
  answer: AssistantAnswer | null;
  status: "pending" | "completed" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type AssistantConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns: AssistantTurn[];
};

export type AssistantConversationSummary = Omit<AssistantConversation, "turns">;

// The attempt token never goes to the browser. It prevents a late response from
// replacing a retry or restoring a deleted conversation.
export type AssistantTurnAttempt = {
  room: AssistantConversation;
  turn: AssistantTurn;
  attemptId: string;
  alreadyCompleted: boolean;
};
