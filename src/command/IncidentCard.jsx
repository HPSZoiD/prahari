import { useState } from 'react';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { UNSPECIFIED_AREA, LOCATION_SOURCE_META, typeById, mapsUrl } from '../config.js';
import { StatusChip, fmtElapsed, fmtTime } from '../lib/ui.jsx';

// One incident card on the Command board.
// Field Report style: 2px left rule = type color, paper-2 background,
// tabular numerals, no emoji. Left rule transitions on status change.
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

  const anyReporter = (events || []).find((e) => e.status === 'active') || (events || [])[0];
  const source = anyReporter?.location_source
    || (incident.area === UNSPECIFIED_AREA ? 'unspecified' : 'manual');
  const srcMeta = LOCATION_SOURCE_META[source] || LOCATION_SOURCE_META.unspecified;

  // Incident reference number
  const refNum = incident?.id ? `No. ${String(incident.id).slice(-4).padStart(4, '0')}` : '—';

  // Log event labels — no emoji
  const LOG_LABEL = {
    created: 'Created',
    report_added: 'Report added',
    acknowledged: 'Acknowledged',
    resolved: 'Resolved',
    cancelled: 'Cancelled',
    location_updated: 'Location updated',
  };

  return (
    <article className={`incident-card st-${incident.status}`} style={{ '--ic': t.accent }}>
      <div className="ic-main">
        {/* Row 1: type label + area + status chip */}
        <div className="ic-row-1">
          <span className="ic-type" style={{ color: t.accent }}>{t.label}</span>
          <span className={`ic-area ${incident.area === UNSPECIFIED_AREA ? 'ic-area-unspec' : ''}`}>
            {incident.area}
          </span>
          {isNew && (
            <span className="ic-newbadge tabnum">+{newCount}</span>
          )}
          <StatusChip status={incident.status} />
        </div>

        {/* Reference number */}
        <div className="ic-ref" style={{ marginTop: 2 }}>{refNum}</div>

        {/* Row 2: report count + elapsed + source badge */}
        <div className="ic-row-2">
          <span>
            <span className="ic-count tabnum">{incident.report_count}</span>
            {' '}<span className="ic-count-label">Report{incident.report_count === 1 ? '' : 's'}</span>
          </span>
          <span className={`ic-elapsed tabnum ${!isClosed && elapsedMs > 120000 ? 'urgent' : ''}`}>
            {fmtElapsed(elapsedMs)}
          </span>
          <span className={`src-badge src-${srcMeta.cls}`} title={
            source === 'manual'
              ? 'Reporter selected this area'
              : 'No area selected before sending'
          }>
            {source === 'manual' ? 'Area selected' : 'Area not selected'}
          </span>
          {incident.ack_by && (
            <span className="ic-ackedby">ack by {incident.ack_by} · <span className="tabnum">{fmtTime(incident.ack_at)}</span></span>
          )}
          {incident.resolution_note && (
            <span className="ic-ackedby">"{incident.resolution_note}"</span>
          )}
        </div>

        {/* Unspecified location warning */}
        {incident.area === UNSPECIFIED_AREA && !isClosed && (
          <div className="ic-unspec-warn">
            Location not specified — verify with reporters
          </div>
        )}

        {/* Actions */}
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
              className="btn btn-outline btn-sm" disabled={busy}
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

      {/* Expand toggle */}
      <button
        type="button" className="ic-expand-toggle"
        onClick={() => onToggleExpand(incident.id)}
      >
        {expanded
          ? <><ChevronUp size={12} strokeWidth={1.5} aria-hidden="true" /> Hide reporters</>
          : <><ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" /> {activeReporters.length} reporter{activeReporters.length === 1 ? '' : 's'}</>
        }
      </button>

      {/* Expanded: reporter table + audit log */}
      {expanded && (
        <div className="ic-details">
          <div className="reporters">
            <h4>Reporters</h4>
            {(events || []).length === 0 && (
              <div className="muted small">Loading…</div>
            )}
            {(events || []).map((e) => (
              <div key={e.id} className={`reporter-row ${e.status === 'cancelled' ? 'cancelled' : ''}`}>
                <div className="r-who">
                  <span className="r-name">
                    {e.name || 'Unknown'}{e.status === 'cancelled' && ' (withdrawn)'}
                  </span>
                  <span className="r-roll tabnum">{e.roll}</span>
                  {(e.hostel || e.room) && (
                    <span className="r-res" title="Registered residence (unverified) — a hint from onboarding, not the incident location">
                      {e.hostel}{e.room ? ` · Room ${e.room}` : ''} <em>(unverified)</em>
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
                      Maps ↗
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="audit-log">
            <h4>Audit log</h4>
            {(logs || []).length === 0 && <div className="muted small">No log entries.</div>}
            {(logs || []).map((l) => (
              <div key={l.id} className="log-row">
                <span className="log-ico" aria-hidden="true">
                  {/* Small coloured dot instead of emoji */}
                  <span style={{
                    display: 'inline-block', width: 6, height: 6,
                    borderRadius: '50%',
                    background: l.event === 'created' ? 'var(--seal)'
                      : l.event === 'acknowledged' ? 'var(--warning)'
                      : l.event === 'resolved' ? 'var(--success)'
                      : 'var(--rule-strong)',
                  }} />
                </span>
                <span className={`log-event e-${l.event}`}>
                  {LOG_LABEL[l.event] || l.event.replace(/_/g, ' ')}
                </span>
                <span className="log-actor">
                  {l.actor?.startsWith('command') ? 'Command' : 'student'}
                </span>
                <span className="log-time tabnum">{fmtTime(l.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
