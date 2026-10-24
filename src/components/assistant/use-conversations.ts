"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantStatus } from "@/lib/assistant/types";
import { ASSISTANT_CHAT_NOTICE_VERSION, ASSISTANT_SUMMARY_QUESTION, type AssistantConversation, type AssistantConversationSummary } from "@/lib/assistant/conversation-types";

class ChatRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path.endsWith("/turns") ? 105_000 : path.endsWith("/summaries") ? 60_000 : 15_000);
  try {
    const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin",
      signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    const data = await response.json();
    if (response.status === 401) window.dispatchEvent(new Event("app-session-expired"));
    if (!response.ok) throw new ChatRequestError(data.error || "대화를 불러오지 못했어요.", response.status);
    return data as T;
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    throw new ChatRequestError("연결이 끊어졌거나 응답 시간이 길어졌어요. 대화 상태를 다시 확인해 주세요.", 0);
  } finally { clearTimeout(timer); }
}
const base = "/api/assistant/conversations";
const message = (error: unknown) => error instanceof Error ? error.message : "대화 상태를 확인하지 못했어요.";

export function useConversations() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [rooms, setRooms] = useState<AssistantConversationSummary[]>([]);
  const [room, setRoom] = useState<AssistantConversation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sendingKind, setSendingKind] = useState<"question" | "summary" | null>(null);
  const [error, setError] = useState("");
  const owner = useRef<string | null>(null);
  const epoch = useRef(0);
  const selection = useRef<string | null>(null);
  const view = useRef(0);
  const inFlight = useRef(false);
  const attempts = useRef(new Map<string, { id: string; question: string }>());
  const roomRef = useRef<AssistantConversation | null>(null);
  const initialized = useRef(false);
  const deleted = useRef(new Set<string>());
  const summaryRequest = useRef<AbortController | null>(null);
  const cancelSummary = useCallback(() => { summaryRequest.current?.abort(); }, []);

  const clear = useCallback(() => {
    summaryRequest.current?.abort(); summaryRequest.current = null;
    epoch.current++; view.current++; owner.current = null; selection.current = null; roomRef.current = null;
    inFlight.current = false; attempts.current.clear();
    initialized.current = false; deleted.current.clear();
    setStatus(null); setRooms([]); setRoom(null); setSelected(null); setDrafts({}); setAllowed(false);
    setSending(null); setSendingKind(null); setLoading(false); setError("");
  }, []);
  useEffect(() => () => { epoch.current++; }, []);
  const acceptRoom = useCallback((value: AssistantConversation) => {
    if (deleted.current.has(value.id)) return;
    setRooms(current => [{ id: value.id, title: value.title, created_at: value.created_at, updated_at: value.updated_at },
      ...current.filter(item => item.id !== value.id)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    if (selection.current === value.id) { roomRef.current = value; setRoom(value); }
    const attempt = attempts.current.get(value.id);
    if (attempt && value.turns.some(turn => turn.id === attempt.id && turn.status === "completed")) {
      attempts.current.delete(value.id);
      setDrafts(current => current[value.id] === attempt.question ? { ...current, [value.id]: "" } : current);
    }
  }, []);
  const select = useCallback(async (id: string) => {
    selection.current = id; setSelected(id); roomRef.current = null; setRoom(null); setError(""); setLoading(true);
    const current = epoch.current, revision = ++view.current;
    try {
      const value = await request<{ room: AssistantConversation }>(`${base}/${id}`);
      if (epoch.current === current && view.current === revision) acceptRoom(value.room);
    } catch (failure) { if (epoch.current === current && view.current === revision) setError(message(failure)); }
    finally { if (epoch.current === current && view.current === revision) setLoading(false); }
  }, [acceptRoom]);
  const load = useCallback(async () => {
    const current = epoch.current, revision = ++view.current;
    setLoading(true); setError("");
    try {
      const [availability, conversations] = await Promise.allSettled([request<AssistantStatus>("/api/assistant"),
        request<{ rooms: AssistantConversationSummary[]; ownerId: string }>(base)]);
      if (epoch.current !== current || view.current !== revision) return;
      if (availability.status === "fulfilled") setStatus(availability.value);
      else throw availability.reason;
      if (conversations.status === "rejected") throw conversations.reason;
      const list = conversations.value;
      if (owner.current && owner.current !== list.ownerId) { clear(); return; }
      owner.current = list.ownerId; setRooms(list.rooms);
      const id = list.rooms.some(item => item.id === selection.current) ? selection.current : initialized.current ? null : list.rooms[0]?.id;
      initialized.current = true;
      if (id) await select(id);
      else { selection.current = null; setSelected(null); roomRef.current = null; setRoom(null); }
    } catch (failure) { if (epoch.current === current) setError(message(failure)); }
    finally { if (epoch.current === current) setLoading(false); }
  }, [clear, select]);
  const newChat = useCallback(() => {
    initialized.current = true;
    view.current++; selection.current = null; setSelected(null); roomRef.current = null; setRoom(null); setLoading(false); setError("");
  }, []);

  // An in-flight turn belongs to its room, even when the panel closes or another room is opened.
  // Reopening/reloading can pick up the server's saved pending turn and observe its completion.
  const pending = room?.turns.some(turn => turn.status === "pending") ?? false;
  useEffect(() => {
    if (!selected || !pending) return;
    const current = epoch.current;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request<{ room: AssistantConversation }>(`${base}/${selected}`);
        if (!stopped && epoch.current === current && selection.current === selected) { acceptRoom(result.room); setError(""); }
      } catch (failure) {
        if (!stopped && epoch.current === current) {
          setError(message(failure));
          if (failure instanceof ChatRequestError && failure.status === 404) { newChat(); return; }
        }
      }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [selected, pending, acceptRoom, newChat]);

  const draft = drafts[selected ?? "new"] ?? "";
  const setDraft = (value: string) => setDrafts(current => ({ ...current, [selection.current ?? "new"]: value }));
  const send = async (kind: "question" | "summary" = "question", recordConsent = false) => {
    const question = kind === "summary" ? ASSISTANT_SUMMARY_QUESTION : draft.trim();
    const permitted = kind === "summary" ? status?.recordSummaryAvailable && recordConsent : status?.available && allowed;
    if (!permitted || !question || inFlight.current || pending || loading) return;
    const summaryController = kind === "summary" ? new AbortController() : null;
    summaryRequest.current = summaryController;
    inFlight.current = true;
    const current = epoch.current;
    let id = selection.current;
    setError(""); setSending(id ?? "new"); setSendingKind(kind);
    try {
      let target = roomRef.current;
      if (!id) {
        const candidateId = attempts.current.get("new")?.id ?? crypto.randomUUID();
        attempts.current.set("new", { id: candidateId, question });
        const created = await request<{ room: AssistantConversation }>(base, { method: "POST", signal: summaryController?.signal,
          body: JSON.stringify({ id: candidateId, allow_storage: true, notice_version: ASSISTANT_CHAT_NOTICE_VERSION }) });
        if (current !== epoch.current) return;
        id = created.room.id; target = created.room; attempts.current.delete("new");
        if (selection.current === null) { selection.current = id; setSelected(id); }
        setDrafts(previous => ({ ...previous, new: "", [id!]: kind === "summary" ? previous.new ?? "" : question }));
        acceptRoom(target); setSending(id);
      }
      if (!target || target.id !== id) return;
      if (summaryController?.signal.aborted) return;
      const latest = target.turns.at(-1);
      const savedAttempt = attempts.current.get(id);
      const turnId = savedAttempt?.question === question ? savedAttempt.id : latest?.status === "failed" && latest.question === question ? latest.id : crypto.randomUUID();
      attempts.current.set(id, { id: turnId, question });
      const now = new Date().toISOString();
      acceptRoom({ ...target, turns: [...target.turns.filter(turn => turn.id !== turnId),
        { id: turnId, question, answer: null, status: "pending", error: null, created_at: now, updated_at: now }] });
      try {
        const result = await request<{ room: AssistantConversation }>(`${base}/${id}/${kind === "summary" ? "summaries" : "turns"}`, {
          method: "POST", signal: summaryController?.signal, body: JSON.stringify(kind === "summary"
            ? { id: turnId, expected_updated_at: target.updated_at, allow_record_access: true, allow_storage: true }
            : { id: turnId, question, expected_updated_at: target.updated_at, allow_model_processing: true }),
        });
        if (current === epoch.current) acceptRoom(result.room);
      } catch (failure) {
        if (current !== epoch.current) return;
        // Never resend automatically when the response is lost: first read the stable turn ID.
        const restored = await request<{ room: AssistantConversation }>(`${base}/${id}`).catch(() => null);
        if (current !== epoch.current) return;
        if (restored) acceptRoom(restored.room);
        const completed = restored?.room.turns.some(turn => turn.id === turnId && turn.status === "completed");
        if (!completed && selection.current === id && !summaryController?.signal.aborted) setError(message(failure));
      }
    } catch (failure) { if (current === epoch.current && !summaryController?.signal.aborted) setError(message(failure)); }
    finally { if (current === epoch.current) { inFlight.current = false; setSending(null); setSendingKind(null); summaryRequest.current = null; } }
  };
  const remove = async (id: string) => {
    const current = epoch.current;
    await request(`${base}/${id}`, { method: "DELETE" });
    if (current !== epoch.current) return;
    deleted.current.add(id);
    attempts.current.delete(id);
    setRooms(previous => previous.filter(item => item.id !== id));
    setDrafts(previous => { const value = { ...previous }; delete value[id]; return value; });
    if (selection.current === id) newChat();
  };
  return { status, rooms, room, selected, draft, setDraft, allowed, setAllowed, loading, sending, sendingKind, pending, error, setError,
    clear, load, select, newChat, send: () => send(), sendSummary: (consent: boolean) => send("summary", consent), cancelSummary, remove };
}
