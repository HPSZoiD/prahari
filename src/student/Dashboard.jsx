import { useEffect, useRef, useState } from 'react';
import { HeartPulse, Flame, Shield, MapPin, ChevronRight } from 'lucide-react';
import { AREAS, HOLD_MS, SOS_TYPES, UNSPECIFIED_AREA } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { getSessionId } from '../lib/session.js';
import { startWarmWatch, cachedFix, refineLocation, getLocationStatus } from '../lib/location.js';
import HoldButton from './HoldButton.jsx';

// Icon map for SOS types (lucide, no emoji)
const TYPE_ICONS = {
  medical: HeartPulse,
  fire: Flame,
  safety: Shield,
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

  return (
    <div>
      {/* Profile pill */}
      <div className="profile-chip">
        <div className="who">
          <div className="name">{profile.name}</div>
          <div className="meta">
            {profile.hostel}{profile.room ? ` · ${profile.room}` : ''}
          </div>
        </div>
        <div className="actions">
          <button className="btn-ghost" onClick={onEdit}>Edit</button>
        </div>
      </div>

      {/* Type selector */}
      <div className="section-label">What is happening?</div>
      <div className="type-grid" role="radiogroup" aria-label="Emergency type">
        {SOS_TYPES.map((t) => {
          const Icon = TYPE_ICONS[t.id];
          const sel = type?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={sel}
              className={`type-card ${sel ? 'selected' : ''}`}
              style={{ '--tc': t.accent }}
              onClick={() => setType(t)}
            >
              <span className="t-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.5} />
              </span>
              <span className="t-label">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Area row */}
      <div className="section-label">Where are you? (optional)</div>

      {areaOpen ? (
        <>
          <div className="area-picker">
            <MapPin size={15} strokeWidth={1.5} style={{ color: 'var(--ink-2)', flexShrink: 0 }} aria-hidden="true" />
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
              autoFocus
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
              ? <>Reporting from <strong>{area}</strong> · clears in 10 min</>
              : <>No area picked — alert sends under <strong>{UNSPECIFIED_AREA}</strong>. Command will confirm with reporters.</>}
          </div>
        </>
      ) : (
        <div
          className="dash-area-row"
          role="button"
          tabIndex={0}
          aria-label="Set reporting area"
          onClick={() => setAreaOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAreaOpen(true); }}
        >
          <span className="area-label">Reporting from</span>
          <span className={`gps-chip ${fixNote === 'GPS off' ? 'off' : ''}`}>{fixNote || 'GPS…'}</span>
          <span className={`area-value ${area ? '' : 'unset'}`}>{area || 'Not set'}</span>
          <ChevronRight size={15} strokeWidth={1.5} style={{ color: 'var(--ink-2)', flexShrink: 0 }} aria-hidden="true" />
        </div>
      )}

      {/* Send */}
      <div className="section-label">Send alert</div>

      <div className="hold-zone">
        <HoldButton
          holdMs={HOLD_MS}
          disabled={!selected || sending}
          armed={Boolean(selected) && !sending}
          onComplete={fire}
          label={selected ? 'HOLD' : 'SELECT TYPE'}
          sublabel={selected ? '2 seconds' : ''}
        />
        <div className="hold-hint">
          {selected ? 'Hold to send' : 'Select a type to arm'}
        </div>
        {error && (
          <div className="chip chip-red" role="alert">
            {error}
          </div>
        )}
      </div>

      {sending && (
        <div className="sending-overlay" role="status">
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          Sending report…
        </div>
      )}
    </div>
  );
}
