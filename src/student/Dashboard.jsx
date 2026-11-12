import { useEffect, useRef, useState } from 'react';
import { HeartPulse, Flame, Shield, MapPin } from 'lucide-react';
import { AREAS, HOLD_MS, SOS_TYPES, UNSPECIFIED_AREA } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { getSessionId } from '../lib/session.js';
import { startWarmWatch, cachedFix, refineLocation, getLocationStatus } from '../lib/location.js';
import { haptic } from '../lib/haptic.js';
import HoldButton from './HoldButton.jsx';

// Icon map for SOS types (lucide, no emoji)
const TYPE_ICONS = {
  medical: HeartPulse,
  fire: Flame,
  safety: Shield,
};

const TYPE_TINTS = {
  medical: 'var(--red)',
  fire: 'var(--orange)',
  safety: 'var(--blue)',
};

// Area TTL: clear selection 10 min after last set, on every reload.
const AREA_TTL_MS = 10 * 60 * 1000;

export default function Dashboard({ profile, onFired, onEdit }) {
  const [type, setType] = useState(null);
  const [area, setArea] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [fixNote, setFixNote] = useState(null);
  const [areaOpen, setAreaOpen] = useState(false);
  const firedRef = useRef(false);
  const areaTimerRef = useRef(null);

  // ── Area TTL ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (areaTimerRef.current) clearTimeout(areaTimerRef.current);
    if (area !== null) {
      areaTimerRef.current = setTimeout(() => setArea(null), AREA_TTL_MS);
    }
    return () => { if (areaTimerRef.current) clearTimeout(areaTimerRef.current); };
  }, [area]);

  // Warm the GPS cache silently.
  useEffect(() => {
    startWarmWatch();
    const t = setInterval(() => {
      const f = cachedFix();
      const st = getLocationStatus();
      setFixNote(
        f ? 'GPS ready'
          : st === 'denied' ? 'GPS off'
          : 'GPS…',
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
      const { data, error: rpcError } = await supabase.rpc('raise_sos', {
        p_session: session,
        p_name: profile.name,
        p_roll: profile.roll,
        p_phone: null,
        p_area: area,
        p_type: type.id,
        p_lat: fix?.lat ?? null,
        p_lng: fix?.lng ?? null,
        p_acc: fix?.accuracy_m ?? null,
        p_silent: true,
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

      // Refine location after SOS is out — never blocking.
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
            if (ok?.ok) setFixNote('GPS refined');
          }).catch(() => {});
        });
      }
    } catch (err) {
      setError(err.message || 'Could not send the report. Check your connection and try again.');
      setSending(false);
      firedRef.current = false;
    }
  };

  const selected = type ? SOS_TYPES.find((t) => t.id === type.id) : null;
  const selectedIdx = SOS_TYPES.findIndex((t) => t.id === type?.id);

  return (
    <div>
      {/* Profile card */}
      <div className="pr-card pr-profile pr-enter" style={{ '--i': 1 }}>
        <div className="pr-avatar" aria-hidden="true">
          {(profile.name || '?').trim().charAt(0).toUpperCase()}
        </div>
        <div className="pr-profile__text">
          <div className="pr-profile__name">{profile.name}</div>
          <div className="pr-profile__sub">
            {profile.hostel}{profile.room ? ` · ${profile.room}` : ''}
          </div>
        </div>
        <button type="button" className="pr-link" onClick={onEdit}>Edit</button>
      </div>

      {/* Type selector */}
      <h3 className="pr-section-title pr-enter" style={{ '--i': 2 }}>What is happening?</h3>
      <div
        className="pr-seg pr-enter"
        style={{ '--i': 3, '--idx': Math.max(selectedIdx, 0) }}
        data-has-value={selectedIdx >= 0}
        role="radiogroup"
        aria-label="Emergency type"
      >
        <span className="pr-seg__thumb" aria-hidden="true" />
        {SOS_TYPES.map((t) => {
          const Icon = TYPE_ICONS[t.id];
          const sel = type?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={sel}
              className="pr-seg__item"
              style={{ '--seg-tint': TYPE_TINTS[t.id] }}
              onClick={() => { setType(t); haptic(8); }}
            >
              <Icon size={26} strokeWidth={1.75} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Area row */}
      <h3 className="pr-section-title pr-enter" style={{ '--i': 4 }}>Where are you? (optional)</h3>

      {areaOpen ? (
        <div className="pr-enter" style={{ '--i': 5 }}>
          <div className="pr-area-picker">
            <MapPin size={18} strokeWidth={1.75} style={{ color: 'var(--label-2)', flexShrink: 0 }} aria-hidden="true" />
            <input
              className="pr-area-input"
              list="area-options"
              placeholder="Pick your current area…"
              value={area ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setArea(AREAS.includes(v) ? v : (v === '' ? null : v));
              }}
              autoComplete="off"
              autoFocus
              aria-label="Current area (optional)"
            />
            <datalist id="area-options">
              {AREAS.map((a) => <option key={a} value={a} />)}
            </datalist>
            {area !== null && (
              <button
                type="button" className="pr-area-clear" aria-label="Clear area"
                onClick={() => setArea(null)}
              >✕</button>
            )}
          </div>
          <div className="pr-area-note">
            {area !== null
              ? <>Reporting from <strong>{area}</strong> · clears in 10 min</>
              : <>No area picked — alert sends under <strong>{UNSPECIFIED_AREA}</strong>. Command will confirm with reporters.</>}
          </div>
        </div>
      ) : (
        <div className="pr-list pr-enter" style={{ '--i': 5 }}>
          <button
            type="button"
            className="pr-row"
            aria-label="Set reporting area"
            onClick={() => setAreaOpen(true)}
          >
            <span className="pr-row__label">Reporting from</span>
            <span className={`pr-chip ${fixNote === 'GPS off' ? 'is-off' : ''}`}>{fixNote || 'GPS…'}</span>
            <span className={`pr-row__value ${area ? '' : 'unset'}`}>{area || 'Not set'}</span>
            <svg className="pr-chevron" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6" /></svg>
          </button>
        </div>
      )}

      {/* Send */}
      <h3 className="pr-section-title pr-enter" style={{ '--i': 6 }}>Send alert</h3>

      <div className="pr-sos-zone pr-enter" style={{ '--i': 7 }}>
        <div className="pr-sos-wrap">
          <HoldButton
            holdMs={HOLD_MS}
            disabled={!selected || sending}
            armed={Boolean(selected) && !sending}
            onComplete={fire}
            label={selected ? 'HOLD' : 'SELECT TYPE'}
            sublabel={selected ? '2 seconds' : ''}
          />
          <p className="pr-sos-caption">
            {selected ? 'Hold to send' : 'Select a type to arm'}
          </p>
          {error && (
            <div className="pr-error-chip" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>

      {sending && (
        <div className="pr-sending" role="status">
          <span className="pr-spinner" />
          Sending report…
        </div>
      )}
    </div>
  );
}
