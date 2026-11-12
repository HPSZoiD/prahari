import { useCallback, useEffect, useRef, useState } from 'react';
import { typeById } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { getSessionId } from '../lib/session.js';
import { ConnPill, StatusChip, fmtTime } from '../lib/ui.jsx';

// Live status screen: Sent → Acknowledged → Resolved (or Cancelled).
// Subscribes to the student's own incident; polls as a fallback so a
// Reset Drill / dropped socket can never leave a stale screen.
export default function ActiveSOS({ active, profile, onEnded }) {
  const [incident, setIncident] = useState(null);
  const [conn, setConn] = useState('connecting');
  const [missing, setMissing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelBlocked, setCancelBlocked] = useState(null);
  const endedRef = useRef(false);

  const t = typeById(active.type);

  const fetchIncident = useCallback(async () => {
    const { data, error } = await supabase
      .from('incidents').select('*').eq('id', active.incident_id).limit(1);
    if (error) return;
    if (!data || data.length === 0) {
      // Incident gone (Reset Drill) → wrap up gracefully.
      setMissing(true);
      if (!endedRef.current) { endedRef.current = true; setTimeout(() => onEnded('reset'), 900); }
      return;
    }
    setIncident(data[0]);
    setMissing(false);
  }, [active.incident_id, onEnded]);

  // Initial fetch + realtime subscription to THIS incident.
  useEffect(() => {
    fetchIncident();
    const ch = supabase.channel(`student-sos-${active.incident_id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'incidents', filter: `id=eq.${active.incident_id}` },
        (payload) => { if (payload.new) setIncident(payload.new); })
      .subscribe((status) => {
        setConn(status === 'SUBSCRIBED' ? 'live' : 'reconnecting');
        if (status === 'SUBSCRIBED') fetchIncident(); // heal after reconnect
      });
    return () => { supabase.removeChannel(ch); };
  }, [active.incident_id, fetchIncident]);

  // Belt-and-braces polling (catches truncate-on-reset with no realtime event).
  useEffect(() => {
    const iv = setInterval(fetchIncident, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') fetchIncident(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchIncident]);

  // Terminal states → hand control back (after a short beat so the student
  // actually sees the "Resolved" moment).
  useEffect(() => {
    if (!incident || endedRef.current) return;
    if (incident.status === 'resolved' || incident.status === 'cancelled') {
      endedRef.current = true;
      const st = incident.status;
      const tm = setTimeout(() => onEnded(st), 1400);
      return () => clearTimeout(tm);
    }
  }, [incident, onEnded]);

  const doCancel = async () => {
    setCancelling(true);
    setCancelBlocked(null);
    const { data, error } = await supabase.rpc('cancel_sos', {
      p_event: active.event_id,
      p_session: getSessionId(),
    });
    setCancelling(false);
    if (error) { setCancelBlocked(error.message); return; }
    if (data && data.ok === false) {
      if (data.reason === 'already_acknowledged') {
        setCancelBlocked('Too late to cancel — help has already been acknowledged.');
        fetchIncident();
      } else {
        setCancelBlocked('This report is no longer active.');
      }
      return;
    }
    if (!endedRef.current) { endedRef.current = true; onEnded('cancelled'); }
  };

  const status = missing ? 'reset' : (incident?.status || 'active');
  const others = Math.max((incident?.report_count ?? 1) - 1, 0);
  // Per spec A6: show what the student actually reported — a manual area
  // selection, or the reserved Unspecified bucket.
  const reportedArea = active.area || incident?.area || 'Unspecified';
  const areaWasSelected = active.location_source
    ? active.location_source === 'manual'
    : reportedArea !== 'Unspecified';

  const banner = {
    active: { cls: 'st-active', big: 'SOS SENT', sub: 'Campus Command has your alert. Stay calm and safe.' },
    acknowledged: { cls: 'st-acknowledged', big: 'HELP ACKNOWLEDGED', sub: 'Command has seen your SOS. Stay where you are if it is safe.' },
    resolved: { cls: 'st-resolved', big: 'RESOLVED', sub: 'The incident has been closed. Thank you.' },
    cancelled: { cls: 'st-cancelled', big: 'SOS CANCELLED', sub: 'Your report was cancelled before anyone else was affected.' },
    reset: { cls: 'st-cancelled', big: 'DRILL ENDED', sub: 'This drill was reset from the Command board.' },
  }[status] || { cls: 'st-active', big: 'SOS SENT', sub: '' };

  const step = status === 'active' ? 1 : status === 'acknowledged' ? 2 : 3;

  return (
    <div className="active-sos">
      <div className={`sos-banner ${banner.cls}`}>
        <div className="big">{banner.big}</div>
        <div className="sub">{banner.sub}</div>
      </div>

      <div className="timeline" aria-hidden="true">
        <div className={`tl-step ${step >= 1 ? 'done' : ''}`}>
          <div className="tl-dot" />
          <div className="tl-label">Sent</div>
          <div className="tl-time">{fmtTime(active.sent_at)}</div>
        </div>
        <div className={`tl-step ${step === 2 ? 'now' : ''} ${step > 2 ? 'done' : ''}`}>
          <div className="tl-dot" />
          <div className="tl-label">Acknowledged</div>
          <div className="tl-time">{fmtTime(incident?.ack_at)}</div>
        </div>
        <div className={`tl-step ${step > 2 ? 'done' : ''}`}>
          <div className="tl-dot" />
          <div className="tl-label">Resolved</div>
          <div className="tl-time">{fmtTime(incident?.resolved_at)}</div>
        </div>
      </div>

      <div className="card sos-info-card">
        <div className="sos-info-row">
          <span className="k">Emergency type</span>
          <span className="v">{t.icon} {t.label}</span>
        </div>
        <div className="sos-info-row">
          <span className="k">Reporting from</span>
          <span className="v">
            {areaWasSelected ? reportedArea : 'Location not set'}
          </span>
        </div>
        <div className="sos-info-row">
          <span className="k">Status</span>
          <span className="v"><StatusChip status={incident?.status || 'active'} /></span>
        </div>
      </div>

      {others > 0 && (
        <div className="others-note">
          You + <strong>{others} other{others > 1 ? 's' : ''}</strong> reported this from{' '}
          {areaWasSelected ? reportedArea : 'an unspecified location'} — Command sees it as one incident.
        </div>
      )}

      {status === 'active' && (
        <div className="cancel-zone">
          {confirmCancel ? (
            <div className="cancel-confirm">
              <button className="btn btn-danger" onClick={doCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Yes, cancel my SOS'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmCancel(false)} disabled={cancelling}>
                Keep it active
              </button>
            </div>
          ) : (
            <button className="btn btn-outline" onClick={() => setConfirmCancel(true)}>
              Cancel SOS (only before acknowledgement)
            </button>
          )}
          {cancelBlocked && <div className="chip chip-indigo">{cancelBlocked}</div>}
        </div>
      )}

      <div className="center" style={{ marginTop: 6 }}>
        <ConnPill state={conn} />
      </div>
    </div>
  );
}
