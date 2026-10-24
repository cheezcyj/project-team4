export type AssistantCitation = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  pdfPages: number[];
  section?: string;
  evidenceRole?: string;
  reuseLabel?: string;
  reuseUrl?: string;
  attribution?: string;
  adaptationNotice?: string;
  // Earlier saved conversations can retain these citation fields.
  licenseLabel?: string;
  licenseUrl?: string;
  retrievedAt?: string;
};

export type AssistantStatus = {
  available: boolean;
  draftPreview: boolean;
  message: string;
  recordSummaryAvailable?: boolean;
};

export type FastingRecordSummary = {
  range: { start: string; end: string; label: string };
  asOf: string;
  timezone: "Asia/Seoul";
  measurementContext: "fasting";
  unit: "mg/dL";
  count: number;
  recordedDays: number;
  missingDays: number;
  average: number | null;
  min: number | null;
  max: number | null;
};

export type AssistantAnswer = {
  kind: "answer" | "no_evidence" | "unsupported" | "safety" | "record_summary";
  answer: string;
  citations: AssistantCitation[];
  draftPreview: boolean;
  recordSummary?: FastingRecordSummary;
  sourceSupplemented?: boolean;
};

export const ASSISTANT_MAX_QUESTION_LENGTH = 1000;
