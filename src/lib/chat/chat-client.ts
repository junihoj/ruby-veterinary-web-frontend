import { io, type Socket } from "socket.io-client";
import type {
  ChatCitation,
  ChatContact,
  ChatMessage,
  ChatState,
  CitationFrame,
  DoneFrame,
  ErrorFrame,
  ExpiredFrame,
  HandoffFrame,
  NoticeFrame,
  StaffMessageFrame,
  TokenFrame,
} from "./types";

export const INITIAL_STATE: ChatState = {
  status: "idle",
  messages: [],
  handoff: "none",
  contact: null,
  errorCode: null,
};

const DEFAULT_CONTACT: ChatContact = {
  phone: "+2348139640640",
  formUrl: "https://ruby-veterinary.com",
  bookingUrl: "https://calendly.com/ezeonyekachukwu97/30min",
};

export interface ChatClientConfig {
  apiBaseUrl: string;
  socketPath: string;
  contact: ChatContact;
}

export function readChatConfig(): ChatClientConfig {
  return {
    apiBaseUrl: (
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1"
    ).replace(/\/+$/, ""),
    socketPath:
      process.env.NEXT_PUBLIC_CHAT_SOCKET_PATH ?? "/api/v1/chat/socket.io",
    contact: {
      phone: process.env.NEXT_PUBLIC_CLINIC_PHONE ?? DEFAULT_CONTACT.phone,
      formUrl:
        process.env.NEXT_PUBLIC_CLINIC_CONTACT_URL ?? DEFAULT_CONTACT.formUrl,
      bookingUrl:
        process.env.NEXT_PUBLIC_CLINIC_BOOKING_URL ??
        DEFAULT_CONTACT.bookingUrl,
    },
  };
}

class ChatHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChatHttpError";
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  RATE_LIMITED:
    "You're sending messages too quickly. Wait a minute, then try again.",
  CAP_REACHED:
    "The assistant has reached today's limit. Please call the clinic, or try again tomorrow.",
  MESSAGE_TOO_LONG: "That message is too long. Shorten it and send again.",
  SESSION_FULL:
    "This chat has reached its limit. Start a new chat, or call the clinic.",
  UNAUTHORIZED:
    "This chat session is no longer valid. Start a new chat to continue.",
  PROVIDER_ERROR:
    "Staff messaging is unavailable right now. Please call the clinic, or try again in a moment.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};

/**
 * Session + frame state machine for the clinic chat (messaging-protocol.md).
 * Owns the Socket.IO connection, seq cursor, reconnect/backoff, visibility
 * and online recovery, and exposes an immutable snapshot for React.
 */
export class ChatClient {
  private state: ChatState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private socket: Socket | null = null;
  private sessionId: string | null = null;
  private sessionReady: Promise<string> | null = null;
  private cursor = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private readonly onVisibility = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      !this.socket?.connected &&
      this.state.status !== "expired"
    ) {
      this.socket?.connect();
    }
  };
  private readonly onOnline = () => {
    if (!this.socket?.connected && this.state.status !== "expired") {
      this.socket?.connect();
    }
  };

  constructor(private readonly config: ChatClientConfig) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ChatState => this.state;

  getServerSnapshot = (): ChatState => INITIAL_STATE;

  async open(): Promise<void> {
    // React Strict Mode mounts, cleans up, and mounts again in development;
    // `destroy()` is therefore reversible and `open()` revives the client.
    this.destroyed = false;
    if (this.state.status === "expired") return;
    if (this.socket?.connected) return;

    this.setState({
      status: this.sessionId ? "reconnecting" : "connecting",
      errorCode: null,
    });

    try {
      await this.ensureSession();
      this.connectSocket();
    } catch (error) {
      this.fail(error);
    }
  }

  async send(text: string): Promise<boolean> {
    const value = text.trim();
    if (!value || this.destroyed || this.isBlocked()) return false;

    if (!this.socket?.connected) {
      await this.open();
      const connected = await this.waitForConnection();
      if (!connected) {
        this.pushError("OFFLINE");
        return false;
      }
    }

    this.socket?.emit("msg", { text: value });
    return true;
  }

  async requestHandoff(): Promise<boolean> {
    if (this.destroyed || this.isBlocked()) return false;
    if (this.state.handoff !== "none") return true;

    if (!this.socket?.connected) {
      await this.open();
      const connected = await this.waitForConnection();
      if (!connected) {
        this.pushError("OFFLINE");
        return false;
      }
    }

    this.socket?.emit("handoff");
    return true;
  }

  async restart(): Promise<void> {
    this.socket?.disconnect();
    this.socket = null;
    this.sessionId = null;
    this.sessionReady = null;
    this.cursor = 0;
    this.state = {
      ...INITIAL_STATE,
      contact: this.state.contact,
      status: "connecting",
    };
    this.emit();
    await this.open();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket.io.removeAllListeners();
      this.socket = null;
    }
    this.listeners.clear();
  }

  markRead(): void {
    // Reserved for an unread badge; the panel reads live state already.
  }

  private isBlocked(): boolean {
    if (this.state.status === "expired") return true;
    return (
      this.state.errorCode === "UNAUTHORIZED" ||
      this.state.errorCode === "CAP_REACHED" ||
      this.state.errorCode === "SESSION_FULL"
    );
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (this.sessionReady) return this.sessionReady;

    this.sessionReady = (async () => {
      const response = await fetch(`${this.config.apiBaseUrl}/chat/session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      if (!response.ok) {
        throw new ChatHttpError(
          response.status,
          `Session request failed (${response.status})`,
        );
      }

      const payload = (await response.json()) as {
        data?: { sessionId?: string; seq?: number };
      };
      const sessionId = payload.data?.sessionId;
      if (!sessionId) throw new Error("Session response was missing sessionId");

      this.sessionId = sessionId;
      this.cursor = payload.data?.seq ?? 0;
      return sessionId;
    })().finally(() => {
      this.sessionReady = null;
    });

    return this.sessionReady;
  }

  private connectSocket(): void {
    if (this.destroyed) return;
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }

    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;

    const origin = new URL(this.config.apiBaseUrl).origin;
    const socket = io(`${origin}/chat`, {
      path: this.config.socketPath,
      transports: ["websocket"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 15_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
      autoConnect: true,
      auth: { last_seen_seq: this.cursor },
    });
    this.socket = socket;

    socket.io.on("reconnect_attempt", () => {
      socket.auth = { last_seen_seq: this.cursor };
    });
    socket.on("connect", () => {
      this.setState({ status: "connected", errorCode: null });
    });
    socket.on("disconnect", (reason) => {
      if (this.state.status === "expired") return;
      this.setState({
        status: reason === "io client disconnect" ? "idle" : "reconnecting",
      });
    });
    socket.on("connect_error", () => {
      if (this.state.status !== "expired") {
        this.setState({ status: "reconnecting" });
      }
    });

    socket.on("notice", (frame: NoticeFrame) => this.onNotice(frame));
    socket.on("token", (frame: TokenFrame) => this.onToken(frame));
    socket.on("citation", (frame: CitationFrame) => this.onCitation(frame));
    socket.on("done", (frame: DoneFrame) => this.onDone(frame));
    socket.on("error", (frame: ErrorFrame) => this.onError(frame));
    socket.on("handoff", (frame: HandoffFrame) => this.onHandoff(frame));
    socket.on("staff_message", (frame: StaffMessageFrame) =>
      this.onStaffMessage(frame),
    );
    socket.on("expired", (frame: ExpiredFrame) => this.onExpired(frame));

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }
    this.heartbeat = setInterval(() => {
      if (!this.socket?.connected && this.state.status !== "expired") {
        this.socket?.connect();
      }
    }, 45_000);
  }

  private waitForConnection(timeoutMs = 8_000): Promise<boolean> {
    const socket = this.socket;
    if (!socket) return Promise.resolve(false);
    if (socket.connected) return Promise.resolve(true);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const onConnect = () => {
        cleanup();
        resolve(true);
      };
      const onError = () => {
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("connect_error", onError);
      };
      socket.once("connect", onConnect);
      socket.once("connect_error", onError);
      socket.connect();
    });
  }

  private onNotice(frame: NoticeFrame): void {
    this.cursor = Math.max(this.cursor, frame.seq);
    this.upsert({
      key: `notice:${frame.seq}`,
      seq: frame.seq,
      role: "system",
      text: frame.text,
      citations: [],
      streaming: false,
      notice: true,
    });
  }

  private onToken(frame: TokenFrame): void {
    if (frame.role === "user") {
      this.upsert({
        key: `user:${frame.seq}`,
        seq: frame.seq,
        role: "user",
        text: frame.text,
        citations: [],
        streaming: false,
      });
      this.cursor = Math.max(this.cursor, frame.seq);
      return;
    }

    const key = `assistant:${frame.seq}`;
    if (frame.final) {
      const existing = this.find(key);
      if (frame.text.length > 0) {
        this.upsert({
          key,
          seq: frame.seq,
          role: "assistant",
          text: frame.text,
          citations: existing?.citations ?? [],
          streaming: false,
        });
      } else if (existing) {
        this.patch(key, { streaming: false });
      } else {
        this.upsert({
          key,
          seq: frame.seq,
          role: "assistant",
          text: "",
          citations: [],
          streaming: false,
        });
      }
      return;
    }

    const existing = this.find(key);
    if (existing) {
      this.patch(key, { text: existing.text + frame.text, streaming: true });
    } else {
      this.upsert({
        key,
        seq: frame.seq,
        role: "assistant",
        text: frame.text,
        citations: [],
        streaming: true,
      });
    }
  }

  private onCitation(frame: CitationFrame): void {
    const key = `assistant:${frame.seq}`;
    const existing = this.find(key);
    if (existing) {
      this.patch(key, { citations: frame.sources });
    } else {
      this.upsert({
        key,
        seq: frame.seq,
        role: "assistant",
        text: "",
        citations: frame.sources,
        streaming: true,
      });
    }
  }

  private onDone(frame: DoneFrame): void {
    const seq = frame.messageSeq ?? frame.seq;
    this.cursor = Math.max(this.cursor, seq);
    const assistantKey = `assistant:${seq}`;
    if (this.find(assistantKey)) {
      this.patch(assistantKey, {
        streaming: false,
        ...(frame.citations ? { citations: frame.citations } : {}),
      });
    }
    const userKey = `user:${seq}`;
    if (this.find(userKey)) this.patch(userKey, { streaming: false });
  }

  private onError(frame: ErrorFrame): void {
    const code = frame.code || "INTERNAL";
    this.setState({
      errorCode: code,
      status: code === "UNAUTHORIZED" ? "error" : this.state.status,
    });
    this.upsert({
      key: `error:${Date.now()}`,
      seq: frame.seq,
      role: "system",
      text: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL,
      citations: [],
      streaming: false,
      error: true,
    });
  }

  private onHandoff(frame: HandoffFrame): void {
    this.setState({ handoff: frame.state });
    this.upsert({
      key: `handoff:${frame.seq}`,
      seq: frame.seq,
      role: "system",
      text:
        frame.state === "closed"
          ? "The staff conversation has ended."
          : frame.state === "accepted"
            ? `${frame.staffName ?? "A staff member"} is replying here now.`
            : "A staff member has been notified and will reply here.",
      citations: [],
      streaming: false,
      handoff: true,
    });
  }

  private onStaffMessage(frame: StaffMessageFrame): void {
    this.upsert({
      key: `staff:${frame.seq}`,
      seq: frame.seq,
      role: "staff",
      text: frame.text,
      citations: [],
      streaming: false,
      ...(frame.senderName ? { senderName: frame.senderName } : {}),
    });
    this.cursor = Math.max(this.cursor, frame.seq);
  }

  private onExpired(frame: ExpiredFrame): void {
    this.setState({
      status: "expired",
      contact: frame.contact,
      errorCode: "EXPIRED",
    });
    this.socket?.disconnect();
  }

  private pushError(code: string): void {
    this.setState({ errorCode: code, status: "error" });
    this.upsert({
      key: `error:${Date.now()}`,
      seq: 0,
      role: "system",
      text:
        code === "OFFLINE"
          ? "The chat could not reconnect. Check your connection, then start a new chat or call the clinic."
          : ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL,
      citations: [],
      streaming: false,
      error: true,
    });
  }

  private fail(error: unknown): void {
    let message = "The clinic chat is unavailable right now.";
    if (error instanceof ChatHttpError) {
      if (error.status === 429) {
        message = "Too many chat attempts. Please wait a minute and try again.";
      } else if (error.status === 403) {
        message = "This chat is not available from this site.";
      }
    }
    this.setState({ status: "error", errorCode: "NETWORK" });
    this.upsert({
      key: `error:${Date.now()}`,
      seq: 0,
      role: "system",
      text: message,
      citations: [],
      streaming: false,
      error: true,
    });
  }

  private find(key: string): ChatMessage | undefined {
    return this.state.messages.find((message) => message.key === key);
  }

  private upsert(message: ChatMessage): void {
    const messages = this.state.messages.slice();
    const index = messages.findIndex((item) => item.key === message.key);
    if (index >= 0) {
      messages[index] = { ...messages[index], ...message };
    } else {
      messages.push(message);
    }
    this.setState({ messages });
  }

  private patch(key: string, patch: Partial<ChatMessage>): void {
    const messages = this.state.messages.slice();
    const index = messages.findIndex((item) => item.key === key);
    if (index < 0) return;
    messages[index] = { ...messages[index], ...patch };
    this.setState({ messages });
  }

  private setState(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export type { ChatCitation, ChatContact, ChatMessage, ChatState };
