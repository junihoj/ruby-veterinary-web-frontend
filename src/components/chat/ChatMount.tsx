"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const ChatWidget = dynamic(() => import("./ChatWidget"), {
  ssr: false,
  loading: () => <ChatLoading />,
});

function ChatLoading() {
  return (
    <div className="rv-chat fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] flex-col items-center justify-center gap-2 rounded-t-[24px] border border-[var(--rv-line)] bg-[var(--rv-panel)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[390px] sm:rounded-[24px]">
      <span className="rv-chat-serif text-[18px] text-[var(--rv-ink)]">
        Ruby Veterinary
      </span>
      <span className="text-[12px] text-[var(--rv-muted)]">
        Opening the clinic chat…
      </span>
    </div>
  );
}

/**
 * Mount point for the clinic chat. The launcher ships in the initial bundle;
 * the panel (and socket.io-client) is only fetched once the visitor opens it.
 */
export function ChatMount() {
  const enabled = process.env.NEXT_PUBLIC_CHAT_ENABLED === "true";
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <>
      {loaded ? <ChatWidget open={open} onClose={() => setOpen(false)} /> : null}
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        aria-label="Open clinic chat"
        aria-expanded={open}
        aria-controls="rv-chat-panel"
        tabIndex={open ? -1 : 0}
        className={`rv-chat fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2.5 rounded-full border border-white/10 bg-[var(--rv-ink)] px-3 text-[var(--rv-paper)] shadow-[0_10px_30px_-12px_rgba(20,33,31,0.6)] transition-opacity duration-150 hover:bg-[var(--rv-ink-soft)] sm:h-[52px] sm:pl-4 sm:pr-5 ${
          open ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--rv-ruby)]">
          <ChatIcon className="h-4 w-4" />
        </span>
        <span className="hidden text-[13px] font-medium tracking-wide sm:inline">
          Ask the clinic
        </span>
      </button>
    </>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16H9l-4.5 3v-3.2A2.5 2.5 0 0 1 4.5 13.5z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </svg>
  );
}
