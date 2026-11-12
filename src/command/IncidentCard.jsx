import { useState } from 'react';
import { UNSPECIFIED_AREA, LOCATION_SOURCE_META, typeById, mapsUrl } from '../config.js';
import { StatusChip, fmtElapsed, fmtTime } from '../lib/ui.jsx';

// One incident on the Command board. Status drives colour:
// active = RED (reserved for active alerts), acknowledged = indigo,
// resolved = green, cancelled = slate.
// V1.1: shows WHERE the area came from (manual selection vs Unspecified
// bucket) and, per reporter, the registered-residence hint + Maps link.
export default function IncidentCard({
  incident, events, logs, now, onAck, onResolve, onToggleExpand, expanded, busy,
}) {
  const [note, setNote] = useState('');
  const t = typeById(incident.type);
  const isNew = incident.status === 'acknowledged' &&
    incident.ack_at && incident.last_report_at > incident.ack_at;
  const newCount = isNew ? (incident.newCount ?? incident.report_count) : 0;

  const elapsedMs = now - new Date(incident.created_at).getTime();
  const isClosed = incident.status === 'resolved' || incident.status === 'cancelled';
  const activeReporters = (events || []).filter((e) => e.status === 'active');

  // Source of the area label: any reporter's location_source (all reporters
  // of one incident share it by construction of the grouping key).
  const anyReporter = (events || []).find((e) => e.status === 'active') || (events || [])[0];
  const source = anyReporter?.location_source
    || (incident.area === UNSPECIFIED_AREA ? 'unspecified' : 'manual');
  const srcMeta = LOCATION_SOURCE_META[source] || LOCATION_SOURCE_META.unspecified;

  const LOG_ICON = {
    created: '🚨', report_added: '👥', acknowledged: '✅',
    resolved: '🏁', cancelled: '↩️', location_updated: '📍',
  };

  return (
    <article className={`incident-card st-${incident.status}`}>
      <div className="ic-main">
        <div className="ic-row-1">
          <span className="ic-type-icon" aria-hidden="true">{t.icon}</span>
          <span className={`ic-area ${incident.area === UNSPECIFIED_AREA ? 'ic-area-unspec' : ''}`}>
            {incident.area}
          </span>
          {isNew && <span className="ic-newbadge">+{newCount} NEW</span>}
          <StatusChip status={incident.status} />
        </div>
        <div className="ic-row-2">
          <span className="ic-count">
            {incident.report_count} report{incident.report_count === 1 ? '' : 's'}
          </span>
          <span className={`ic-elapsed ${!isClosed && elapsedMs > 120000 ? 'urgent' : ''}`}>
            ⏱ {fmtElapsed(elapsedMs)}
          </span>
          <span>{t.label}</span>
          <span className={`src-badge src-${srcMeta.cls}`} title={
            source === 'manual'
              ? 'The reporter picked this area before sending'
              : 'No area was picked before sending'
          }>
            {source === 'manual' ? '🗺 Area selected' : '❓ Area not selected'}
          </span>
          {incident.ack_by && (
            <span className="ic-ackedby">ack by {incident.ack_by} · {fmtTime(incident.ack_at)}</span>
          )}
          {incident.resolution_note && (
            <span className="ic-ackedby">“{incident.resolution_note}”</span>
          )}
        </div>

        {incident.area === UNSPECIFIED_AREA && !isClosed && (
          <div className="ic-unspec-warn">
            ⚠ Location not specified — verify with reporters (call-back / residence hint below).
          </div>
        )}

        {!isClosed && (
          <div className="ic-actions">
            {incident.status === 'active' && (
              <button
                className="btn btn-sm" disabled={busy}
                onClick={() => onAck(incident.id)}
              >
                Acknowledge
              </button>
            )}
            <button
              className="btn btn-sm btn-danger" disabled={busy}
              onClick={() => onResolve(incident.id, note)}
            >
              Resolve
            </button>
            <input
              className="ic-note-input" placeholder="Resolution note (optional)"
              value={note} onChange={(e) => setNote(e.target.value)}
              aria-label="Resolution note"
            />
          </div>
        )}
      </div>

      <button
        type="button" className="ic-expand-toggle"
        onClick={() => onToggleExpand(incident.id)}
      >
        {expanded ? '▲ Hide reporters & audit log' : `▼ ${activeReporters.length} reporter${activeReporters.length === 1 ? '' : 's'} & audit log`}
      </button>

      {expanded && (
        <div className="ic-details">
          <div className="reporters">
            <h4>Reporters</h4>
            {(events || []).length === 0 && (
              <div className="muted small">Loading reporters…</div>
            )}
            {(events || []).map((e) => (
              <div key={e.id} className={`reporter-row ${e.status === 'cancelled' ? 'cancelled' : ''}`}>
                <div className="r-who">
                  <span className="r-name">
                    {e.name || 'Unknown'}{e.status === 'cancelled' && ' (cancelled)'}
                  </span>
                  <span className="r-roll">{e.roll}</span>
                  {(e.hostel || e.room) && (
                    <span className="r-res" title="Registered residence (unverified) — a hint from onboarding, not the incident location">
                      🏠 {e.hostel}{e.room ? ` · Room ${e.room}` : ''} <em>(unverified)</em>
                    </span>
                  )}
                </div>
                <span className="r-flags">
                  <span className={`loc-chip ${
                    e.location_status === 'precise' ? 'precise'
                    : e.location_status === 'approximate' ? 'approximate' : 'none'}`}
                  >
                    {e.lat != null && e.lng != null
                      ? (e.accuracy_m != null ? `±${Math.round(e.accuracy_m)}m` : 'map')
                      : (e.location_status || 'no fix')}
                  </span>
                  {e.lat != null && e.lng != null && (
                    <a className="maps-link" href={mapsUrl(e.lat, e.lng)} target="_blank" rel="noreferrer">
                      Open in Maps ↗
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="audit-log">
            <h4>Audit log (append-only)</h4>
            {(logs || []).length === 0 && <div className="muted small">No log entries.</div>}
            {(logs || []).map((l) => (
              <div key={l.id} className="log-row">
                <span className="log-ico" aria-hidden="true">{LOG_ICON[l.event] || '•'}</span>
                <span className={`log-event e-${l.event}`}>
                  {l.event === 'report_added' ? 'report added' : l.event.replace('_', ' ')}
                </span>
                <span className="log-actor">
                  {l.actor?.startsWith('command') ? 'Command' : 'student'}
                </span>
                <span className="log-time">{fmtTime(l.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
