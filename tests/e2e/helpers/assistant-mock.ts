import { expect, type Page } from "@playwright/test";
import type { AssistantAnswer } from "../../../src/lib/assistant/types";
import type { AssistantConversation } from "../../../src/lib/assistant/conversation-types";

export const chatConsentLabel = "대화를 계정에 저장하고 이 대화 내용을 AI로 처리하는 데 동의합니다.";
type TurnInput = { id: string; question: string; expected_updated_at: string; allow_model_processing: boolean };

// This is a browser boundary double for rendering and navigation. Persistence is
// separately exercised through the real conversation API and isolated database tests.
export async function mockAssistantConversations(page: Page, generate: (input: TurnInput) => Promise<AssistantAnswer>) {
  const rooms = new Map<string, AssistantConversation>();
  const submissions: TurnInput[] = [];
  const creations: Record<string, unknown>[] = [];
  let clock = Date.now();
  const now = () => new Date(++clock).toISOString();
  await page.route("**/api/assistant", async route => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { available: true, draftPreview: true, recordSummaryAvailable: false,
      message: "일반 건강정보를 질문할 수 있어요." } });
  });
  await page.route("**/api/assistant/conversations**", async route => {
    const method = route.request().method();
    const segments = new URL(route.request().url()).pathname.split("/").filter(Boolean);
    const id = segments[3];
    if (!id && method === "GET") {
      const listed = [...rooms.values()].map(room => ({ id: room.id, title: room.title, created_at: room.created_at, updated_at: room.updated_at }));
      await route.fulfill({ json: { rooms: listed, ownerId: "11111111-1111-4111-8111-111111111111" } });
      return;
    }
    if (!id && method === "POST") {
      const input = route.request().postDataJSON(); creations.push(input);
      expect(input.allow_storage).toBe(true); expect(input.notice_version).toBe("assistant-chat-v1");
      const stamp = now();
      const room: AssistantConversation = rooms.get(input.id) ?? { id: input.id, title: "새 대화", created_at: stamp, updated_at: stamp, turns: [] };
      rooms.set(room.id, room);
      await route.fulfill({ status: 201, json: { room } });
      return;
    }
    const room = rooms.get(id);
    if (!room) { await route.fulfill({ status: 404, json: { error: "대화를 찾지 못했어요." } }); return; }
    if (method === "DELETE") { rooms.delete(id); await route.fulfill({ json: { ok: true } }); return; }
    if (method === "GET") { await route.fulfill({ json: { room } }); return; }
    expect(segments[4]).toBe("turns");
    const input = route.request().postDataJSON() as TurnInput; submissions.push(input);
    expect(Object.keys(input).sort()).toEqual(["allow_model_processing", "expected_updated_at", "id", "question"]);
    expect(input.expected_updated_at).toBe(room.updated_at); expect(input.allow_model_processing).toBe(true);
    const stamp = now();
    const turn = { id: input.id, question: input.question, answer: null as AssistantAnswer | null,
      status: "pending" as "pending" | "completed" | "failed", error: null as string | null, created_at: stamp, updated_at: stamp };
    room.turns = [...room.turns.filter(item => item.id !== input.id), turn]; room.updated_at = stamp;
    if (room.turns.length === 1) room.title = input.question;
    try {
      turn.answer = await generate(input); turn.status = "completed"; turn.updated_at = now(); room.updated_at = turn.updated_at;
      await route.fulfill({ json: { room } }).catch(() => undefined);
    } catch {
      turn.status = "failed"; turn.error = "답변 연결을 확인하지 못했어요.";
      turn.updated_at = now(); room.updated_at = turn.updated_at;
      await route.abort("failed").catch(() => undefined);
    }
  });
  return { rooms, submissions, creations };
}
