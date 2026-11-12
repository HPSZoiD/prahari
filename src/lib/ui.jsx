// Small shared UI primitives used by both apps.
// Field Report design system: no emoji, tabular numerals.

import { useEffect, useRef, useState } from 'react';
import { STATUS_META } from '../config.js';

// ── toasts ───────────────────────────────────────────────────────────────────
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = (text, tone = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };
  return { toasts, push };
}

export function Toasts({ toasts, className = '' }) {
  if (!toasts.length) return null;
  return (
    <div className={`toasts ${className}`.trim()} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

// ── status chip ──────────────────────────────────────────────────────────────
export function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, tone: 'slate' };
  return <span className={`chip chip-${meta.tone}`}>{meta.label}</span>;
}

// ── connection pill ──────────────────────────────────────────────────────────
export function ConnPill({ state }) {
  const map = {
    connecting:   { label: 'Connecting', cls: 'conn-amber' },
    live:         { label: 'Live',       cls: 'conn-green' },
    reconnecting: { label: 'Reconnecting', cls: 'conn-amber' },
  };
  const m = map[state] || map.connecting;
  return (
    <span className={`conn-pill ${m.cls}`}>
      <span
        style={{
          display: 'inline-block',
          width: 6, height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      {m.label}
    </span>
  );
}

// ── ticking clock for elapsed timers ─────────────────────────────────────────
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function fmtElapsed(ms) {
  if (ms == null || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── hold-to-confirm action (used by Reset Drill) ──────────────────────────────
export function HoldAction({ label, holdMs = 1200, onConfirm, className = '', disabled = false }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef(null);
  const start = useRef(0);
  const done = useRef(false);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!done.current) setProgress(0);
  };

  const begin = () => {
    if (disabled || raf.current) return;
    done.current = false;
    start.current = performance.now();
    const tick = () => {
      const p = Math.min((performance.now() - start.current) / holdMs, 1);
      setProgress(p);
      if (p >= 1) {
        raf.current = null;
        done.current = true;
        setProgress(0);
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  return (
    <button
      type="button"
      className={`hold-action ${className}`}
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin(); }}
      onKeyUp={stop}
    >
      <span className="hold-action-fill" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <span className="hold-action-label">{progress > 0 ? 'Keep holding…' : label}</span>
    </button>
  );
}
