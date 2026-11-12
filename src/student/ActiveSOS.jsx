import { useCallback, useEffect, useRef, useState } from 'react';
import { typeById } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { getSessionId } from '../lib/session.js';
import { ConnPill, StatusChip, fmtTime } from '../lib/ui.jsx';

// Live status screen: Sent → Acknowledged → Resolved (or Cancelled).
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
      setMissing(true);
      if (!endedRef.current) { endedRef.current = true; setTimeout(() => onEnded('reset'), 900); }
      return;
    }
    setIncident(data[0]);
    setMissing(false);
  }, [active.incident_id, onEnded]);

  useEffect(() => {
    fetchIncident();
    const ch = supabase.channel(`student-sos-${active.incident_id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'incidents', filter: `id=eq.${active.incident_id}` },
        (payload) => { if (payload.new) setIncident(payload.new); })
      .subscribe((status) => {
        setConn(status === 'SUBSCRIBED' ? 'live' : 'reconnecting');
        if (status === 'SUBSCRIBED') fetchIncident();
      });
    return () => { supabase.removeChannel(ch); };
  }, [active.incident_id, fetchIncident]);

  useEffect(() => {
    const iv = setInterval(fetchIncident, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') fetchIncident(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchIncident]);

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
        setCancelBlocked('Too late to withdraw — help has already been acknowledged.');
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
  const reportedArea = active.area || incident?.area || 'Unspecified';
  const areaWasSelected = active.location_source
    ? active.location_source === 'manual'
    : reportedArea !== 'Unspecified';

  // Incident number for display
  const refNum = incident?.id ? `No. ${String(incident.id).slice(-4).padStart(4, '0')}` : '—';

  const step = status === 'active' ? 0 : status === 'acknowledged' ? 1 : 2;

  const STEPS = [
    { label: 'Sent',         time: active.sent_at },
    { label: 'Acknowledged', time: incident?.ack_at },
    { label: 'Resolved',     time: incident?.resolved_at },
  ];

  return (
    <div className="pr-active">
      {/* Filed header */}
      <div className="pr-card pr-filed">
        <div className="pr-filed__top">
          <span className="pr-filed__mark">Report filed</span>
          <StatusChip status={status === 'reset' ? 'cancelled' : (status || 'active')} />
        </div>
        <div className="pr-filed__ref">{refNum}</div>
        <div className="pr-filed__note">
          {status === 'reset'
            ? 'Drill ended from Command.'
            : status === 'active'
            ? 'Campus Command has your alert. Stay calm.'
            : status === 'acknowledged'
            ? 'Command has seen your report. Stay where you are if safe.'
            : status === 'resolved'
            ? 'The incident has been closed. Thank you.'
            : 'Report withdrawn.'}
        </div>
      </div>

      {/* Resolved stamp */}
      {status === 'resolved' && (
        <div className="pr-resolved">Resolved</div>
      )}

      {/* Timeline */}
      <div className="pr-card pr-timeline">
        {STEPS.map((s, i) => {
          const done = i < step;
          const now  = i === step;
          return (
            <div key={s.label} className={`tl-step ${done ? 'done' : ''} ${now ? 'now' : ''}`}>
              <div className="tl-dot" />
              <div className="tl-body">
                <div className="tl-label">{s.label}</div>
                <div className="tl-time tnum">{fmtTime(s.time)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info card */}
      <div className="pr-card pr-info-card">
        <div className="pr-info-row">
          <span className="k">Emergency type</span>
          <span className="v">{t.label}</span>
        </div>
        <div className="pr-info-row">
          <span className="k">Reporting from</span>
          <span className="v">
            {areaWasSelected ? reportedArea : 'Location not specified'}
          </span>
        </div>
        <div className="pr-info-row">
          <span className="k">Status</span>
          <span className="v">
            <StatusChip status={incident?.status || 'active'} />
          </span>
        </div>
      </div>

      {/* Others note */}
      {others > 0 && (
        <div className="pr-others">
          You + <strong>{others} other{others > 1 ? 's' : ''}</strong> reported this
          {areaWasSelected ? ` from ${reportedArea}` : ''} — Command sees it as one incident.
        </div>
      )}

      {/* Withdraw (pre-ack only) */}
      {status === 'active' && (
        <div className="pr-cancel">
          {confirmCancel ? (
            <div className="pr-cancel-confirm">
              <button className="pr-btn pr-btn-sm pr-btn-danger" onClick={doCancel} disabled={cancelling}>
                {cancelling ? 'Withdrawing…' : 'Yes, withdraw report'}
              </button>
              <button className="pr-btn pr-btn-sm pr-btn-secondary" onClick={() => setConfirmCancel(false)} disabled={cancelling}>
                Keep active
              </button>
            </div>
          ) : (
            <button className="pr-btn pr-btn-sm pr-btn-secondary" onClick={() => setConfirmCancel(true)}>
              Withdraw report
            </button>
          )}
          {cancelBlocked && <div className="pr-error-chip">{cancelBlocked}</div>}
        </div>
      )}

      <div className="pr-center">
        <ConnPill state={conn} />
      </div>
    </div>
  );
}
