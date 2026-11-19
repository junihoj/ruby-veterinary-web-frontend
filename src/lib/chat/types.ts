export interface ChatCitation {
  title: string;
  category: string;
  effectiveDate: string | null;
}

export interface ChatContact {
  phone: string;
  formUrl: string;
  bookingUrl: string;
}

export type ChatRole = "user" | "assistant" | "system" | "staff";

export interface ChatMessage {
  key: string;
  seq: number;
  role: ChatRole;
  text: string;
  citations: ChatCitation[];
  streaming: boolean;
  notice?: boolean;
  error?: boolean;
  handoff?: boolean;
}

export type ChatStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "expired";

export type HandoffState = "none" | "requested" | "accepted" | "closed";

export interface ChatState {
  status: ChatStatus;
  messages: ChatMessage[];
  handoff: HandoffState;
  contact: ChatContact | null;
  errorCode: string | null;
}

interface BaseFrame {
  seq: number;
  type: string;
}

export interface TokenFrame extends BaseFrame {
  type: "token";
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface CitationFrame extends BaseFrame {
  type: "citation";
  sources: ChatCitation[];
}

export interface DoneFrame extends BaseFrame {
  type: "done";
  messageSeq: number;
  citations?: ChatCitation[];
}

export interface ErrorFrame extends BaseFrame {
  type: "error";
  code: string;
  retryAfterMs?: number;
}

export interface HandoffFrame extends BaseFrame {
  type: "handoff";
  state: "requested" | "accepted" | "closed";
  staffName?: string;
}

export interface StaffMessageFrame extends BaseFrame {
  type: "staff_message";
  text: string;
  senderName?: string;
}

export interface NoticeFrame extends BaseFrame {
  type: "notice";
  text: string;
}

export interface ExpiredFrame extends BaseFrame {
  type: "expired";
  contact: ChatContact;
}
