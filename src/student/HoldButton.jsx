import { useCallback, useEffect, useRef, useState } from 'react';

// Hold-to-trigger button with SVG progress ring.
// The 2s timer and pointer/keyboard handlers are unchanged; only the visual
// shell and ring styling moved to the iOS-style components.css.
export default function HoldButton({
  holdMs = 2000,
  disabled = false,
  armed = true,
  onComplete,
  label = 'HOLD',
  sublabel = '2 seconds',
}) {
  const SIZE = 184;
  const STROKE = 6;
  // Ring radius: half size minus half stroke, with a small inset gap
  const R = (SIZE / 2) - STROKE - 4;
  const CIRC = 2 * Math.PI * R;
  const cx = SIZE / 2;

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
    // Vibrate on press if not silent
    try { navigator.vibrate?.(12); } catch { /* ok */ }
    const tick = () => {
      const p = Math.min((performance.now() - startRef.current) / holdMs, 1);
      setProgress(p);
      if (p >= 1) {
        rafRef.current = null;
        doneRef.current = true;
        setState('fired');
        try { navigator.vibrate?.(24); } catch { /* ok */ }
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

  const displayLabel = state === 'fired' ? 'Sent' : label;
  const displaySub   = state === 'holding' ? 'Keep holding…' : (sublabel || '2 seconds');
  const visualState  = !armed ? 'idle' : state === 'holding' ? 'holding' : 'armed';

  return (
    <div
      className="pr-sos"
      data-state={visualState}
      style={{ '--hold-ms': `${holdMs}ms` }}
    >
      {/* SVG ring — rotated so progress starts at 12 o'clock */}
      <svg className="pr-sos__ring" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle className="pr-sos__track" cx={cx} cy={cx} r={R} />
        <circle
          ref={ringRef}
          className="pr-sos__progress"
          cx={cx} cy={cx} r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC}
        />
      </svg>

      <button
        type="button"
        className="pr-sos__btn"
        disabled={disabled}
        aria-label={`Hold to send ${displayLabel} SOS`}
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
        <span className="pr-sos__label">{displayLabel}</span>
        {!disabled && <span className="pr-sos__sub">{displaySub}</span>}
      </button>
    </div>
  );
}
