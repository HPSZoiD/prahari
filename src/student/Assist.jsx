import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { streamAssist } from "../lib/assistClient.js";
import { loadThread, saveThread, clearThread, newId } from "../lib/assistStore.js";
import { SUGGESTED_PROMPTS } from "../data/campus.mjs";
import HelplineSheet from "./HelplineSheet.jsx";

const COOLDOWN_MS = 1200;
const MAX_INPUT = 2000;

const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const IconSend = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const clock = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

export default function Assist({ onGoToSOS }) {
  const [messages, setMessages] = useState(() => loadThread());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const scrolled = useScrolled();

  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const stickRef = useRef(true);
  const lastSendRef = useRef(0);

  useEffect(() => { saveThread(messages); }, [messages]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const onScroll = useCallback(() => {
    const doc = document.documentElement;
    stickRef.current = window.innerHeight + window.scrollY >= doc.scrollHeight - 120;
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  useLayoutEffect(() => {
    if (stickRef.current) window.scrollTo(0, document.documentElement.scrollHeight);
  }, [messages, streamingId]);

  const send = useCallback(async (raw) => {
    const text = String(raw ?? "").trim().slice(0, MAX_INPUT);
    if (!text || busy) return;

    const now = Date.now();
    if (now - lastSendRef.current < COOLDOWN_MS) {
      setCooldown(true);
      setTimeout(() => setCooldown(false), COOLDOWN_MS);
      return;
    }
    lastSendRef.current = now;

    const userMsg = { id: newId(), role: "user", content: text, ts: now };
    const botId = newId();
    const botMsg = { id: botId, role: "assistant", content: "", ts: now, pending: true };

    const history = [...messages, userMsg];
    setMessages([...history, botMsg]);
    setInput("");
    setBusy(true);
    setStreamingId(botId);
    stickRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAssist({
        messages: history,
        signal: controller.signal,
        onDelta: (_chunk, full) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === botId ? { ...m, content: full, pending: false } : m))
          );
        },
      });
      setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, pending: false } : m)));
    } catch (err) {
      if (err?.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? { ...m, pending: false, content: m.content || "Stopped.", stopped: true }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? { ...m, pending: false, error: true, content: err?.message || "Something went wrong.", retryText: text }
              : m
          )
        );
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreamingId(null);
    }
  }, [busy, messages]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const retry = useCallback((m) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id && !(x.role === "user" && x.content === m.retryText && x.ts >= m.ts - 5000)));
    setTimeout(() => send(m.retryText), 0);
  }, [send]);

  const onClear = useCallback(() => {
    if (busy) stop();
    if (messages.length && !window.confirm("Clear this conversation?")) return;
    clearThread();
    setMessages([]);
    stickRef.current = true;
  }, [busy, messages.length, stop]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const autoGrow = (e) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const empty = messages.length === 0;

  return (
    <>
      <header className="pr-nav" data-scrolled={scrolled}>
        <div>
          <h1 className="t-large" style={{ margin: 0 }}>Assist</h1>
          <p className="t-sub" style={{ margin: "6px 0 0" }}>
            Safety information and campus helplines. This assistant cannot send an alert.
          </p>
        </div>
        <div className="pr-nav__actions">
          {!empty && (
            <button type="button" className="pr-link" onClick={onClear} aria-label="Clear conversation">
              Clear
            </button>
          )}
          <button
            type="button"
            className="pr-iconbtn glass pressable"
            onClick={() => setSheetOpen(true)}
            aria-label="Emergency helplines"
          >
            <IconPhone />
          </button>
        </div>
      </header>

      <div className="pr-banner pr-enter" style={{ "--i": 1 }} role="note">
        <span className="pr-banner__text">In an emergency, hold the SOS button.</span>
        <button type="button" className="pr-banner__btn pressable" onClick={onGoToSOS}>Go to SOS</button>
      </div>

      {empty ? (
        <section className="pr-empty pr-enter" style={{ "--i": 2 }}>
          <h2 className="t-title3" style={{ margin: 0 }}>Ask about safety on campus</h2>
          <p className="t-sub" style={{ margin: "8px 0 20px" }}>
            Procedures, helplines, and who to contact. Answers come from campus data.
            For anything happening right now, use SOS instead.
          </p>
          <div className="pr-list">
            {SUGGESTED_PROMPTS.map((s) => (
              <button key={s} type="button" className="pr-row" onClick={() => send(s)}>
                <span className="pr-row__label">{s}</span>
                <svg className="pr-chevron" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6" /></svg>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="pr-chat">
          {messages.map((m) => {
            const isUser = m.role === "user";
            const showTyping = m.pending && !m.content && streamingId === m.id;
            return (
              <div
                key={m.id}
                className={`pr-bubble-wrap ${isUser ? "pr-bubble-wrap--user" : "pr-bubble-wrap--bot"}`}
              >
                <div className={`pr-bubble ${isUser ? "pr-bubble--user" : "pr-bubble--bot"}${m.error ? " pr-bubble--error" : ""}`}>
                  {showTyping ? (
                    <span className="pr-typing" aria-label="Assistant is typing"><i /><i /><i /></span>
                  ) : (
                    <>
                      {m.content}
                      {streamingId === m.id && !m.error && <span className="pr-caret" />}
                    </>
                  )}
                </div>
                {m.error && m.retryText && (
                  <button type="button" className="pr-retry" onClick={() => retry(m)}>Try again</button>
                )}
                {!m.pending && m.content && (
                  <div className="pr-bubble-meta">{clock(m.ts)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pr-composer-wrap">
        <div className="pr-composer glass">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_INPUT}
            placeholder="Ask a safety question"
            onChange={(e) => { setInput(e.target.value); autoGrow(e); }}
            onKeyDown={onKeyDown}
            aria-label="Message"
          />
          {busy ? (
            <button type="button" className="pr-send pr-send--stop" onClick={stop} aria-label="Stop response"><IconStop /></button>
          ) : (
            <button type="button" className="pr-send" onClick={() => send(input)} disabled={!input.trim() || cooldown} aria-label="Send message">
              <IconSend />
            </button>
          )}
        </div>
        <p className="pr-composer-note">
          {cooldown ? "Wait a moment before sending again." : "Campus details are sample data. Always verify numbers before relying on them."}
        </p>
      </div>

      <HelplineSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
