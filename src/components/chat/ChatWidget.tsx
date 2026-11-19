"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ChatClient,
  readChatConfig,
} from "@/lib/chat/chat-client";
import type {
  ChatCitation,
  ChatMessage,
  ChatStatus,
} from "@/lib/chat/types";

const SUGGESTIONS = [
  "What are your opening hours?",
  "Do you offer vaccinations?",
  "How do I book a visit?",
];

const STATUS_LABEL: Record<ChatStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  connected: "Online",
  reconnecting: "Reconnecting",
  error: "Offline",
  expired: "Session ended",
};

function statusColor(status: ChatStatus): string {
  if (status === "connected") return "bg-[#7aa88a]";
  if (status === "connecting" || status === "reconnecting") {
    return "bg-[#c99a4a]";
  }
  if (status === "error" || status === "expired") {
    return "bg-[var(--rv-ruby)]";
  }
  return "bg-[var(--rv-line)]";
}

function displayPhone(phone: string): string {
  return phone.replace(/^\+234/, "+234 ").replace(/(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
}

export default function ChatWidget({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [config] = useState(readChatConfig);
  const [client] = useState(() => new ChatClient(config));
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getServerSnapshot,
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [handoffSending, setHandoffSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    void client.open();
    return () => client.destroy();
  }, [client]);

  useEffect(() => {
    if (!open) return;
    client.markRead();
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, client]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [draft]);

  useEffect(() => {
    if (!open || !stickToBottom.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [open, state.messages]);

  const blocked =
    state.status === "expired" ||
    state.errorCode === "UNAUTHORIZED" ||
    state.errorCode === "CAP_REACHED" ||
    state.errorCode === "SESSION_FULL";

  const hasUserMessage = state.messages.some(
    (message) => message.role === "user",
  );

  const submit = async () => {
    if (sending || blocked) return;
    const value = draft;
    if (!value.trim()) return;
    setSending(true);
    const sent = await client.send(value);
    setSending(false);
    if (sent) setDraft("");
  };

  const requestHandoff = async () => {
    if (handoffSending || state.handoff !== "none") return;
    setHandoffSending(true);
    await client.requestHandoff();
    setHandoffSending(false);
  };

  if (!open) return null;

  const contact = state.contact ?? config.contact;

  return (
    <div
      id="rv-chat-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="rv-chat-title"
      className="rv-chat rv-chat-panel fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] flex-col overflow-hidden rounded-t-[24px] border border-[var(--rv-line)] bg-[var(--rv-panel)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[390px] sm:rounded-[24px]"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="bg-[var(--rv-ink)] px-5 pb-4 pt-5 text-[var(--rv-paper)]">
        <div className="flex items-start gap-3">
          <div className="rv-chat-serif flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--rv-ruby)] text-[13px] font-semibold tracking-[0.08em]">
            RV
          </div>
          <div className="min-w-0">
            <h2 id="rv-chat-title" className="rv-chat-serif text-[19px] leading-tight">
              Ruby Veterinary
            </h2>
            <p className="mt-0.5 text-[11.5px] text-white/60">
              Clinic assistant
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="ml-auto -mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-[var(--rv-line)] bg-[var(--rv-paper)] px-5 py-2.5">
        <span className="flex items-center gap-2 text-[11.5px] font-medium text-[var(--rv-muted)]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusColor(state.status)}`}
            aria-hidden="true"
          />
          {STATUS_LABEL[state.status]}
        </span>
        {state.status !== "expired" ? (
          <button
            type="button"
            onClick={() => void requestHandoff()}
            disabled={state.handoff !== "none" || handoffSending}
            className="text-[11.5px] font-medium text-[var(--rv-teal-deep)] underline decoration-[var(--rv-line)] underline-offset-4 disabled:opacity-50"
          >
            {state.handoff === "none"
              ? "Talk to a person"
              : state.handoff === "requested"
                ? "Staff notified"
                : state.handoff === "accepted"
                  ? "Staff replying"
                  : "Conversation ended"}
          </button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (!element) return;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
        }}
        className="rv-chat-scroll flex-1 overflow-y-auto px-5 py-5"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!hasUserMessage ? (
          <div className="mb-5">
            <p className="rv-chat-serif text-[24px] leading-[1.15] text-[var(--rv-ink)]">
              What can we help with?
            </p>
            <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-[var(--rv-muted)]">
              Ask about clinic hours, services, or how to prepare for a visit.
            </p>
            <div className="mt-4">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void client.send(suggestion)}
                  className="flex w-full items-center gap-2 border-b border-[var(--rv-line)] py-2 text-left text-[13px] text-[var(--rv-ink)] hover:text-[var(--rv-teal-deep)]"
                >
                  <PlusIcon className="h-3.5 w-3.5 shrink-0 text-[var(--rv-teal)]" />
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-4">
          {state.messages.map((message) => (
            <MessageBubble key={message.key} message={message} />
          ))}
        </div>
      </div>

      {state.status === "expired" ? (
        <div className="border-t border-[var(--rv-line)] bg-[var(--rv-paper)] px-4 pb-4 pt-4">
          <p className="rv-chat-serif text-[17px] text-[var(--rv-ink)]">
            This chat has ended.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--rv-muted)]">
            Reach the clinic directly and we will pick it up from there.
          </p>
          <div className="mt-3">
            <ContactLink href={`tel:${contact.phone}`} icon={<PhoneIcon className="h-3.5 w-3.5" />}>
              Call {displayPhone(contact.phone)}
            </ContactLink>
            <ContactLink href={contact.formUrl} external icon={<MailIcon className="h-3.5 w-3.5" />}>
              Contact the clinic
            </ContactLink>
            <ContactLink href={contact.bookingUrl} external icon={<CalendarIcon className="h-3.5 w-3.5" />}>
              Book an appointment
            </ContactLink>
          </div>
          <button
            type="button"
            onClick={() => void client.restart()}
            className="mt-3 text-[12px] font-medium text-[var(--rv-teal-deep)] underline underline-offset-4"
          >
            Start a new chat
          </button>
        </div>
      ) : (
        <div className="border-t border-[var(--rv-line)] bg-[var(--rv-panel)] px-4 pb-4 pt-3">
          {state.status === "error" ? (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-[10px] bg-[#f7e9ec] px-3 py-2 text-[12px] text-[var(--rv-ruby)]">
              <span>Connection lost.</span>
              <button
                type="button"
                onClick={() => void client.restart()}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Start a new chat
              </button>
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex items-end gap-2 rounded-[16px] border border-[var(--rv-line)] bg-white px-3 py-2 focus-within:border-[var(--rv-teal)]"
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              maxLength={2000}
              disabled={blocked}
              placeholder="Ask a question…"
              aria-label="Message"
              className="max-h-[120px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-[var(--rv-ink)] outline-none placeholder:text-[var(--rv-muted)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending || blocked}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--rv-teal-deep)] text-[var(--rv-paper)] hover:bg-[var(--rv-ink)] disabled:bg-[var(--rv-line)] disabled:text-[var(--rv-muted)]"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-[11px] leading-relaxed text-[var(--rv-muted)]">
              For an emergency, call{" "}
              <a
                href={`tel:${contact.phone}`}
                className="font-medium text-[var(--rv-teal-deep)] underline underline-offset-2"
              >
                {displayPhone(contact.phone)}
              </a>
              .
            </p>
            {draft.length > 1600 ? (
              <span className="text-[10.5px] text-[var(--rv-muted)]">
                {draft.length}/2000
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.notice) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] bg-[var(--rv-sage)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--rv-muted)]">
        <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--rv-teal-deep)]" />
        <p>{message.text}</p>
      </div>
    );
  }

  if (message.error) {
    return (
      <div
        role="alert"
        className="border-l-2 border-[var(--rv-ruby)] pl-3 text-[12.5px] leading-relaxed text-[var(--rv-ruby)]"
      >
        {message.text}
      </div>
    );
  }

  if (message.handoff) {
    return (
      <div className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--rv-teal-deep)]">
        <PersonIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{message.text}</p>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[4px] bg-[var(--rv-teal-deep)] px-4 py-2.5 text-[14px] leading-relaxed text-[var(--rv-paper)]">
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    );
  }

  if (message.role === "staff") {
    return (
      <div className="mr-auto max-w-[90%] rounded-[16px] rounded-bl-[4px] border border-[var(--rv-line)] bg-[var(--rv-sage)] px-4 py-2.5">
        <p className="mb-1 text-[10.5px] font-semibold text-[var(--rv-teal-deep)]">
          Clinic team
        </p>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--rv-ink)]">
          {message.text}
        </p>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-[var(--rv-teal)] pl-3.5">
      <p className="rv-chat-serif whitespace-pre-wrap text-[15.5px] leading-[1.62] text-[var(--rv-ink)]">
        {message.text}
        {message.streaming ? (
          <span className="rv-caret" aria-hidden="true" />
        ) : null}
      </p>
      {message.citations.length > 0 ? (
        <Sources citations={message.citations} />
      ) : null}
    </div>
  );
}

function Sources({ citations }: { citations: ChatCitation[] }) {
  return (
    <div className="mt-2.5 border-t border-[var(--rv-line)] pt-2">
      <p className="text-[10.5px] font-semibold text-[var(--rv-muted)]">
        Sources
      </p>
      <ol className="mt-1 space-y-1">
        {citations.map((citation, index) => (
          <li
            key={`${citation.title}-${index}`}
            className="text-[11.5px] leading-snug text-[var(--rv-muted)]"
          >
            <span className="mr-1 font-medium text-[var(--rv-teal-deep)]">
              {index + 1}.
            </span>
            <span className="text-[var(--rv-ink)]">{citation.title}</span>
            <span>
              {" "}
              ({citation.category}
              {citation.effectiveDate
                ? `, updated ${citation.effectiveDate}`
                : ""}
              )
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ContactLink({
  href,
  external,
  icon,
  children,
}: {
  href: string;
  external?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="flex items-center justify-between gap-3 border-b border-[var(--rv-line)] py-2.5 text-[13px] font-medium text-[var(--rv-ink)] hover:text-[var(--rv-teal-deep)]"
    >
      <span className="flex items-center gap-2">
        <span className="text-[var(--rv-teal)]">{icon}</span>
        {children}
      </span>
      <ArrowUpRightIcon className="h-3.5 w-3.5 text-[var(--rv-muted)]" />
    </a>
  );
}

function iconProps(className?: string) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4.5 12.5l14-7-5 14-2.6-5.4-6.4-1.6z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c.7-3.4 3.3-5.3 6.5-5.3s5.8 1.9 6.5 5.3" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M8.2 4.5l2 4-1.6 1.6a13 13 0 0 0 4.9 4.9l1.6-1.6 4 2-1 3a1.6 1.6 0 0 1-1.7 1.1C9.6 18.7 5.3 14.4 4.4 7.2A1.6 1.6 0 0 1 5.5 5.5l2.7-1z" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M4.5 7.5l7.5 5.5 7.5-5.5" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}
