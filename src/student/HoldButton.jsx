import { useCallback, useEffect, useRef, useState } from 'react';

// Hold-to-trigger button with an SVG progress ring.
// Pointer events (works for touch + mouse + pen); keyboard via Space/Enter.
export default function HoldButton({
  holdMs = 2000,
  disabled = false,
  armed = true,
  onComplete,
  label = 'HOLD TO SEND SOS',
}) {
  const R = 104;            // ring radius (svg viewBox 232)
  const CIRC = 2 * Math.PI * R;
  const ringRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const [state, setState] = useState('idle'); // idle | holding | fired

  const setProgress = useCallback((p) => {
    if (ringRef.current) {
      ringRef.current.style.strokeDashoffset = String(CIRC * (1 - p));
    }
  }, [CIRC]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (!doneRef.current) {
      setState('idle');
      setProgress(0);
    }
  }, [setProgress]);

  const begin = useCallback(() => {
    if (disabled || rafRef.current || doneRef.current) return;
    setState('holding');
    startRef.current = performance.now();
    const tick = () => {
      const p = Math.min((performance.now() - startRef.current) / holdMs, 1);
      setProgress(p);
      if (p >= 1) {
        rafRef.current = null;
        doneRef.current = true;
        setState('fired');
        onComplete();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, holdMs, onComplete, setProgress]);

  // Reset when re-enabled (e.g., after an error)
  useEffect(() => {
    if (disabled) { doneRef.current = false; setState('idle'); setProgress(0); }
  }, [disabled, setProgress]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <button
      type="button"
      className={`hold-btn ${armed && !disabled ? 'armed' : ''} ${state === 'fired' ? 'fired' : ''}`}
      disabled={disabled}
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); try { e.target.setPointerCapture(e.pointerId); } catch { /* ok */ } begin(); }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); }
      }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="hb-svg" viewBox="0 0 232 232" aria-hidden="true">
        <circle className="hb-ring-bg" cx="116" cy="116" r={R} />
        <circle
          ref={ringRef}
          className="hb-ring-fill"
          cx="116" cy="116" r={R}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC}
        />
      </svg>
      <span className="hb-core">
        <span className="hb-title">
          {state === 'fired' ? 'SENT' : label}
        </span>
        <span className="hb-sub">
          {state === 'holding' ? 'KEEP HOLDING…' : 'HOLD 2 SECONDS'}
        </span>
      </span>
    </button>
  );
}
