export type AssistantCitation = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  pdfPages: number[];
};

export type AssistantStatus = {
  available: boolean;
  draftPreview: boolean;
  message: string;
};

export type AssistantAnswer = {
  kind: "answer" | "no_evidence" | "unsupported" | "safety";
  answer: string;
  citations: AssistantCitation[];
  draftPreview: boolean;
};

export const ASSISTANT_MAX_QUESTION_LENGTH = 1000;
