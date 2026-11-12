import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND, PANELS } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { ConnPill, Toasts, useToasts, useNow } from '../lib/ui.jsx';
import IncidentCard from './IncidentCard.jsx';
import DrillControls from './DrillControls.jsx';
import ShareQR from './ShareQR.jsx';
import { syncSiren, unlockAudio, testSiren } from './Siren.js';

// PRAHARI COMMAND BOARD
// One realtime channel (incidents + sos_events). Siren is DERIVED state:
// exactly one loop while (anyActive && onDuty). Reconnect => full refetch so
// a WiFi blip can never leave stale state on the projector.
export default function Board({ email, onSignOut, demo }) {
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState({});     // incident_id -> [sos_events]
  const [logs, setLogs] = useState({});          // incident_id -> [incident_log]
  const [expanded, setExpanded] = useState(() => new Set());
  const [onDuty, setOnDuty] = useState(false);
  const [conn, setConn] = useState('connecting');
  const [busyId, setBusyId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const { toasts, push } = useToasts();
  const now = useNow(1000);

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // ── data ────────────────────────────────────────────────────────────────────
  const refetchAll = useCallback(async () => {
    const { data: incs, error } = await supabase
      .from('incidents').select('*')
      .order('created_at', { ascending: false }).limit(60);
    if (error) { setLoadError(error.message); return; }
    setLoadError(null);
    setIncidents(incs || []);
    const ids = (incs || []).map((i) => i.id);
    if (ids.length) {
      const { data: evs } = await supabase
        .from('sos_events').select('*')
        .in('incident_id', ids)
        .order('created_at', { ascending: true });
      const m = {};
      for (const e of evs || []) {
        (m[e.incident_id] = m[e.incident_id] || []).push(e);
      }
      setEvents(m);
    } else {
      setEvents({});
    }
  }, []);

  const refreshLogs = useCallback(async (incidentId) => {
    const { data } = await supabase
      .from('incident_log').select('*')
      .eq('incident_id', incidentId)
      .order('ts', { ascending: true });
    setLogs((prev) => ({ ...prev, [incidentId]: data || [] }));
  }, []);

  // ── realtime (single channel) ───────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel('command-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, (payload) => {
        const inc = payload.new;
        if (!inc) return;
        setIncidents((prev) => {
          const idx = prev.findIndex((i) => i.id === inc.id);
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = { ...next[idx], ...inc };
            return next;
          }
          return [inc, ...prev];
        });
        if (expandedRef.current.has(inc.id)) refreshLogs(inc.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_events' }, (payload) => {
        const ev = payload.new;
        if (!ev || !ev.incident_id) return;
        setEvents((prev) => {
          const list = prev[ev.incident_id] || [];
          const idx = list.findIndex((x) => x.id === ev.id);
          const next = idx >= 0
            ? list.map((x) => (x.id === ev.id ? ev : x))
            : [...list, ev];
          return { ...prev, [ev.incident_id]: next };
        });
        if (expandedRef.current.has(ev.incident_id)) refreshLogs(ev.incident_id);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConn('live');
          refetchAll();               // reconnect healing
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConn('reconnecting');
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [refetchAll, refreshLogs]);

  // Initial load + heal when the projector tab regains visibility.
  useEffect(() => {
    refetchAll();
    const onVis = () => { if (document.visibilityState === 'visible') refetchAll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refetchAll]);

  // ── siren: one shared loop, derived from anyActive ──────────────────────────
  const anyActive = useMemo(
    () => incidents.some((i) => i.status === 'active'),
    [incidents],
  );
  useEffect(() => { syncSiren(anyActive, onDuty); }, [anyActive, onDuty]);

  const goOnDuty = async () => {
    if (!onDuty) {
      await unlockAudio();            // user gesture unlocks/resumes the AudioContext
      setOnDuty(true);
      push('On duty — siren armed. Click “Test” once to check the speakers.', 'success');
    } else {
      syncSiren(false, false);        // stop immediately, not on next effect tick
      setOnDuty(false);
      push('Off duty — siren muted.');
    }
  };

  // ── command actions ─────────────────────────────────────────────────────────
  const patchLocal = (id, patch) =>
    setIncidents((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const ack = async (id) => {
    const patch = { status: 'acknowledged', ack_at: new Date().toISOString(), ack_by: email };
    patchLocal(id, patch);
    setBusyId(id);
    const { error } = await supabase.from('incidents').update(patch).eq('id', id);
    setBusyId(null);
    if (error) { push(`Acknowledge failed: ${error.message}`, 'error'); refetchAll(); }
  };

  const resolve = async (id, note) => {
    const patch = {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution_note: note ? note.trim() : null,
    };
    patchLocal(id, patch);
    setBusyId(id);
    const { error } = await supabase.from('incidents').update(patch).eq('id', id);
    setBusyId(null);
    if (error) { push(`Resolve failed: ${error.message}`, 'error'); refetchAll(); }
    else push('Incident resolved.', 'success');
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); refreshLogs(id); }
      return next;
    });
  };

  // ── derived view model ──────────────────────────────────────────────────────
  const withBadges = useMemo(() => incidents.map((inc) => {
    if (inc.status !== 'acknowledged' || !inc.ack_at) return inc;
    const news = (events[inc.id] || []).filter(
      (e) => e.status === 'active' && e.created_at > inc.ack_at);
    return { ...inc, newCount: news.length };
  }), [incidents, events]);

  const open = withBadges.filter((i) => i.status === 'active' || i.status === 'acknowledged');
  const closed = withBadges.filter((i) => i.status === 'resolved' || i.status === 'cancelled');
  const activeCount = open.filter((i) => i.status === 'active').length;

  const panelData = (panel) => open
    .filter((i) => panel.types.includes(i.type))
    .sort((a, b) => {
      const rank = (x) => (x.status === 'active' ? 0 : 1);
      return rank(a) - rank(b) ||
        new Date(a.created_at) - new Date(b.created_at);
    });

  return (
    <div className="command-app">
      <header className="cmd-header">
        <div className="drill-banner">
          <span aria-hidden="true">⚠</span> {BRAND.drillLine}
        </div>
        <div className="cmd-header-top">
          <div className="cmd-brand">
            <span className="brand-icon" aria-hidden="true">🛡️</span>
            <div>
              <div className="brand-name">{BRAND.name}</div>
              <div className="brand-sub">PRAHARI COMMAND · {BRAND.tagline.toUpperCase()}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {demo && <span className="demo-badge">MOCK BACKEND</span>}
            <span className="cmd-tag">COMMAND</span>
            <button className="btn btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
        <div className="cmd-toolbar">
          <button className={`btn on-duty-btn ${onDuty ? 'on' : ''}`} onClick={goOnDuty}>
            {onDuty ? '🟢 ON DUTY' : 'GO ON DUTY'}
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => { testSiren(); if (!onDuty) push('Speaker check played. Siren arms when you GO ON DUTY.'); }}
            title="Play a 1.2s sample — always pressable"
          >
            🔊 Test
          </button>
          <ConnPill state={conn} />
          <span className={`active-count ${activeCount > 0 ? 'hot' : 'calm'}`} aria-live="polite">
            <span className="n">{activeCount}</span> ACTIVE
          </span>
          <span className="active-count calm">
            <span className="n">{open.length - activeCount}</span> ACKED
          </span>
          <span className="toolbar-spacer" />
          <button className="btn btn-outline btn-sm" onClick={() => setShareOpen(true)}>
            📱 Share / QR
          </button>
          <DrillControls
            busy={Boolean(busyId)}
            push={push}
            onAfterReset={() => {
              setIncidents([]); setEvents({}); setLogs({}); setExpanded(new Set());
              refetchAll();
            }}
          />
        </div>
      </header>

      <main className="board-body">
        {loadError && (
          <div className="chip chip-red" style={{ marginBottom: 14 }}>
            Load error: {loadError} — will retry on reconnect
          </div>
        )}

        <div className="panel-grid">
          {PANELS.map((panel) => {
            const list = panelData(panel);
            const hot = list.some((i) => i.status === 'active');
            return (
              <section className="panel" key={panel.id} style={{ '--pc': panel.accent }}>
                <div className="panel-head">
                  <span className="p-icon" aria-hidden="true">{panel.icon}</span>
                  <span className="p-label">{panel.label}</span>
                  <span className={`p-count ${hot ? 'hot' : ''}`}>{list.length}</span>
                </div>
                <div className="panel-body">
                  {list.length === 0 && (
                    <div className="empty-state">
                      <span className="empty-icon" aria-hidden="true">{panel.icon}</span>
                      No active alerts — standing by
                    </div>
                  )}
                  {list.map((inc) => (
                    <IncidentCard
                      key={inc.id}
                      incident={inc}
                      events={events[inc.id] || []}
                      logs={logs[inc.id] || []}
                      now={now}
                      busy={busyId === inc.id}
                      expanded={expanded.has(inc.id)}
                      onToggleExpand={toggleExpand}
                      onAck={ack}
                      onResolve={resolve}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {closed.length > 0 && (
          <section className="closed-section">
            <div className="closed-head">
              Recently closed ({closed.length})
              <span style={{ flex: 1 }} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setIncidents((prev) => prev.filter((i) => i.status === 'active' || i.status === 'acknowledged'))}
              >
                Clear closed
              </button>
            </div>
            <div className="closed-list">
              {closed.slice(0, 12).map((i) => (
                <div className="closed-row" key={i.id}>
                  <strong>{i.area}</strong>
                  <span className="c-meta">
                    {i.report_count} report{i.report_count === 1 ? '' : 's'} ·{' '}
                    {i.type} · closed {new Date(i.resolved_at || i.created_at).toLocaleTimeString()}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className={`chip chip-${i.status === 'resolved' ? 'green' : 'slate'}`}>
                    {i.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="board-footnote">
          {BRAND.name} V1.1 · drill build · no SMS, no calls, no external services ·
          signed in as {email}
        </div>
      </main>

      {shareOpen && <ShareQR onClose={() => setShareOpen(false)} />}
      <Toasts toasts={toasts} />
    </div>
  );
}
