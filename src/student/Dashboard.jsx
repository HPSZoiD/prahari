import { useEffect, useRef, useState } from 'react';
import { AREAS, HOLD_MS, SOS_TYPES, UNSPECIFIED_AREA } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { getSessionId, resetSession } from '../lib/session.js';
import { startWarmWatch, cachedFix, refineLocation, getLocationStatus } from '../lib/location.js';
import HoldButton from './HoldButton.jsx';

// Area selection lives in memory ONLY (never localStorage): it auto-clears
// 10 minutes after the last change and on every page reload, so a stale
// "Canteen" can never leak into tomorrow's report.
const AREA_TTL_MS = 10 * 60 * 1000;

// Student dashboard: type picker → OPTIONAL area selector → HOLD TO SOS.
// V1.1: no silent toggle — the phone is always silent on send. Location is
// cached-first and never blocks the SOS; the area selector never blocks the
// hold button either.
export default function Dashboard({ profile, onFired, onEdit }) {
  const [type, setType] = useState(null);
  const [area, setArea] = useState(null);          // null = not selected
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [fixNote, setFixNote] = useState(null);
  const firedRef = useRef(false);
  const areaTimerRef = useRef(null);

  // ── Area TTL: clear the selection 10 min after it was last set ────────────
  useEffect(() => {
    if (areaTimerRef.current) clearTimeout(areaTimerRef.current);
    if (area !== null) {
      areaTimerRef.current = setTimeout(() => setArea(null), AREA_TTL_MS);
    }
    return () => { if (areaTimerRef.current) clearTimeout(areaTimerRef.current); };
  }, [area]);

  // Warm the GPS cache silently while the student looks at this screen.
  useEffect(() => {
    startWarmWatch();
    const t = setInterval(() => {
      const f = cachedFix();
      const st = getLocationStatus();
      setFixNote(
        f ? `Live location ready — ±${Math.round(f.accuracy_m)}m, sent with your SOS`
          : st === 'denied' ? 'Location permission off — SOS still works (area + residence are sent)'
          : 'Getting a live location fix in the background…',
      );
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const fire = async () => {
    if (firedRef.current || sending) return;
    firedRef.current = true;
    setSending(true);
    setError(null);

    const session = getSessionId();
    const fix = cachedFix();

    try {
      // area === null → 'Unspecified' bucket server-side (raise_sos handles
      // the mapping; we send null, never a guess from hostel or GPS).
      const { data, error: rpcError } = await supabase.rpc('raise_sos', {
        p_session: session,
        p_name: profile.name,
        p_roll: profile.roll,
        p_phone: null,           // V1 does not collect phone numbers
        p_area: area,            // null → 'Unspecified'; a real selection → manual
        p_type: type.id,
        p_lat: fix?.lat ?? null,
        p_lng: fix?.lng ?? null,
        p_acc: fix?.accuracy_m ?? null,
        p_silent: true,          // V1.1: silent by default, no UI toggle
        p_hostel: profile.hostel ?? null,
        p_room: profile.room || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data || !data.event_id) throw new Error('No event returned');

      onFired(data, {
        type: type.id,
        area: data.area || area || UNSPECIFIED_AREA,
        location_source: data.location_source || (area ? 'manual' : 'unspecified'),
        sent_at: new Date().toISOString(),
      });

      // Refine location AFTER the SOS is already out (never blocking).
      if (data.event_id) {
        refineLocation().then((better) => {
          if (!better) return;
          supabase.rpc('update_sos_location', {
            p_event: data.event_id,
            p_session: session,
            p_lat: better.lat,
            p_lng: better.lng,
            p_acc: better.accuracy_m,
          }).then(({ data: ok }) => {
            if (ok?.ok) setFixNote(`Location refined — ±${Math.round(better.accuracy_m)}m`);
          }).catch(() => {});
        });
      }
    } catch (err) {
      setError(err.message || 'Could not send the SOS. Check your connection and try again.');
      setSending(false);
      firedRef.current = false;
    }
  };

  const selected = type ? SOS_TYPES.find((t) => t.id === type.id) : null;

  return (
    <div>
      <div className="profile-chip">
        <div className="avatar" aria-hidden="true">
          {profile.name ? profile.name.slice(0, 1).toUpperCase() : '?'}
        </div>
        <div className="who">
          <div className="name">{profile.name}</div>
          <div className="meta">
            {profile.roll} · {profile.hostel}{profile.room ? ` · Room ${profile.room}` : ''}
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
        </div>
      </div>

      <div className="section-label">1 · What is happening?</div>
      <div className="type-grid" role="radiogroup" aria-label="SOS type">
        {SOS_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={type?.id === t.id}
            className={`type-card ${type?.id === t.id ? 'selected' : ''}`}
            style={{ '--tc': t.accent, borderColor: type?.id === t.id ? t.accent : undefined }}
            onClick={() => setType(t)}
          >
            <span className="t-check" aria-hidden="true">✓</span>
            <span className="t-icon" aria-hidden="true">{t.icon}</span>
            <span className="t-label">{t.label}</span>
            <span className="t-hint">{t.hint}</span>
          </button>
        ))}
      </div>

      {/* Optional area — searchable dropdown from the shared AREAS config.
          Free text is impossible (no <option> from user input), so grouping
          can never fragment. Never gates the hold button. */}
      <div className="section-label">2 · Where are you? <span className="opt-tag">optional</span></div>
      <div className="area-picker">
        <span className="ap-pin" aria-hidden="true">📍</span>
        <input
          className="ap-input"
          list="area-options"
          placeholder="Pick your current area…"
          value={area ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setArea(AREAS.includes(v) ? v : (v === '' ? null : v));
          }}
          autoComplete="off"
          aria-label="Current area (optional)"
        />
        <datalist id="area-options">
          {AREAS.map((a) => <option key={a} value={a} />)}
        </datalist>
        {area !== null && (
          <button
            type="button" className="ap-clear" aria-label="Clear area"
            onClick={() => setArea(null)}
          >✕</button>
        )}
      </div>
      <div className="area-note">
        {area !== null
          ? <>Sending from <strong>{area}</strong> · clears in 10 min</>
          : <>No area picked — the alert still sends instantly under <strong>{UNSPECIFIED_AREA}</strong>, and Command will confirm the location with reporters.</>}
      </div>

      <div className="section-label">3 · Send the alert</div>

      <div className="hold-zone">
        <HoldButton
          holdMs={HOLD_MS}
          disabled={!selected || sending}
          armed={Boolean(selected) && !sending}
          onComplete={fire}
          label={selected ? `HOLD FOR ${selected.label.toUpperCase()} SOS` : 'PICK A TYPE FIRST'}
        />
        <div className="hold-hint">
          {selected
            ? <>Hold for 2 seconds — your SOS goes to Command{' '}
               {area ? <>for <strong>{area}</strong></> : <>with <strong>live location + residence</strong></>}
               </>
            : <>Select Medical, Fire or Safety above to arm the button</>}
        </div>
        <div className="location-note" aria-live="polite">
          <span aria-hidden="true">📍</span> {fixNote || '…'}
        </div>
        {error && (
          <div className="chip chip-red" role="alert" style={{ alignSelf: 'center' }}>
            {error}
          </div>
        )}
      </div>

      {sending && (
        <div className="sending-overlay" role="status">
          <span className="spinner" style={{ width: 34, height: 34, borderWidth: 4 }} />
          Sending your SOS…
        </div>
      )}

      <div className="center" style={{ marginTop: 18 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { resetSession(); }}
          title="Fresh session id — useful when testing repeatedly"
        >
          Reset session (demo reuse)
        </button>
      </div>
    </div>
  );
}
