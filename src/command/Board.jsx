import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse, Flame, Shield, ScrollText, AlertCircle, MoreHorizontal } from 'lucide-react';
import { BRAND, PANELS } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { ConnPill, StatusChip, Toasts, useToasts, useNow, fmtTime } from '../lib/ui.jsx';
import IncidentCard from './IncidentCard.jsx';
import DrillControls from './DrillControls.jsx';
import ShareQR from './ShareQR.jsx';
import { syncSiren, unlockAudio, testSiren } from './Siren.js';

// Lucide icon map for panels
const PANEL_ICONS = {
  HeartPulse, Flame, Shield, ScrollText,
};

function PanelIcon({ name, size = 16, ...props }) {
  const Comp = PANEL_ICONS[name] || AlertCircle;
  return <Comp size={size} strokeWidth={1.5} {...props} />;
}

export default function Board({ email, onSignOut, demo }) {
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState({});
  const [logs, setLogs] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  const [onDuty, setOnDuty] = useState(false);
  const [conn, setConn] = useState('connecting');
  const [busyId, setBusyId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { toasts, push } = useToasts();
  const now = useNow(1000);

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // ── data ──────────────────────────────────────────────────────────────────
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

  // ── realtime ───────────────────────────────────────────────────────────────
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
          refetchAll();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConn('reconnecting');
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [refetchAll, refreshLogs]);

  useEffect(() => {
    refetchAll();
    const onVis = () => { if (document.visibilityState === 'visible') refetchAll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refetchAll]);

  // ── siren ──────────────────────────────────────────────────────────────────
  const anyActive = useMemo(
    () => incidents.some((i) => i.status === 'active'),
    [incidents],
  );
  useEffect(() => { syncSiren(anyActive, onDuty); }, [anyActive, onDuty]);

  const goOnDuty = async () => {
    if (!onDuty) {
      await unlockAudio();
      setOnDuty(true);
      push('On duty — siren armed. Click "Test" once to verify the speakers.', 'success');
    } else {
      syncSiren(false, false);
      setOnDuty(false);
      push('Off duty — siren muted.');
    }
  };

  // ── actions ────────────────────────────────────────────────────────────────
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

  // ── view model ─────────────────────────────────────────────────────────────
  const withBadges = useMemo(() => incidents.map((inc) => {
    if (inc.status !== 'acknowledged' || !inc.ack_at) return inc;
    const news = (events[inc.id] || []).filter(
      (e) => e.status === 'active' && e.created_at > inc.ack_at);
    return { ...inc, newCount: news.length };
  }), [incidents, events]);

  const open   = withBadges.filter((i) => i.status === 'active' || i.status === 'acknowledged');
  const closed = withBadges.filter((i) => i.status === 'resolved' || i.status === 'cancelled');
  const activeCount = open.filter((i) => i.status === 'active').length;

  const panelData = (panel) => open
    .filter((i) => panel.types.includes(i.type))
    .sort((a, b) => {
      const rank = (x) => (x.status === 'active' ? 0 : 1);
      return rank(a) - rank(b) || new Date(a.created_at) - new Date(b.created_at);
    });

  // Split: first 3 panels shown in grid, warden full-width below
  const gridPanels   = PANELS.filter((p) => p.id !== 'warden');
  const wardenPanel  = PANELS.find((p) => p.id === 'warden');

  return (
    <div className="command-app">
      {/* Breathing alert rule — only when active incidents exist */}
      {anyActive && <div className="alert-rule" aria-hidden="true" />}

      {/* Top bar */}
      <header className="cmd-header">
        <div className="cmd-header-top">
          {/* Left: wordmark */}
          <div className="cmd-brand">
            <span className="cmd-wordmark">{BRAND.name}</span>
            <span className="cmd-mode">Command</span>
          </div>

          {/* Center: active count */}
          <div
            className={`active-count ${activeCount > 0 ? 'hot' : ''}`}
            aria-live="polite"
            title="Active incidents"
          >
            <span className="n tabnum">{activeCount}</span>
            <span className="lbl">Active</span>
          </div>

          {/* Right */}
          <div className="cmd-header-right">
            <ConnPill state={conn} />

            {/* On-duty switch */}
            <button
              className={`duty-toggle ${onDuty ? 'on' : ''}`}
              role="switch"
              aria-checked={onDuty}
              onClick={goOnDuty}
            >
              <span className="duty-track" aria-hidden="true"><span className="duty-thumb" /></span>
              <span className="duty-label">{onDuty ? 'On duty' : 'Off duty'}</span>
            </button>

            {/* Overflow menu */}
            <div className="menu-wrap">
              <button
                className="icon-btn"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={18} strokeWidth={1.75} />
              </button>
              {menuOpen && (
                <>
                  <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
                  <div className="menu-panel" role="menu">
                    <button
                      className="menu-item" role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        testSiren();
                        if (!onDuty) push('Speaker check played. Siren arms when on duty.');
                      }}
                    >
                      Test siren
                    </button>
                    <button
                      className="menu-item" role="menuitem"
                      onClick={() => { setMenuOpen(false); setShareOpen(true); }}
                    >
                      Share / QR
                    </button>
                    <DrillControls
                      inMenu
                      busy={Boolean(busyId)}
                      push={push}
                      onMenuAction={() => setMenuOpen(false)}
                      onAfterReset={() => {
                        setIncidents([]); setEvents({}); setLogs({}); setExpanded(new Set());
                        refetchAll();
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            <button className="btn-ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="board-body">
        {loadError && (
          <div className="chip chip-red" style={{ marginBottom: 16 }}>
            Load error: {loadError} — will retry on reconnect
          </div>
        )}

        {/* Three-panel grid: Medical / Fire / Security */}
        <div className="panel-grid">
          {gridPanels.map((panel) => {
            const list = panelData(panel);
            const hot = list.some((i) => i.status === 'active');
            return (
              <section
                className="panel"
                key={panel.id}
                style={{ '--pc': panel.accent }}
                aria-label={`${panel.label} panel`}
              >
                <div className={`panel-head ${hot ? 'has-active' : ''}`}>
                  <span className="p-icon" aria-hidden="true">
                    <PanelIcon name={panel.lucideIcon} size={15} />
                  </span>
                  <span className="p-label">{panel.label}</span>
                  <span className={`p-count ${hot ? 'hot' : ''}`}>{list.length}</span>
                </div>
                <div className="panel-body">
                  {list.length === 0 && (
                    <div className="empty-state">
                      <span className="empty-text">No active reports</span>
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

        {/* Warden ledger — full width */}
        {wardenPanel && (() => {
          const list = panelData(wardenPanel);
          const hot = list.some((i) => i.status === 'active');
          return (
            <section
              className="panel warden-ledger"
              style={{ '--pc': wardenPanel.accent }}
              aria-label="Warden ledger — all types"
            >
              <div className={`panel-head ${hot ? 'has-active' : ''}`}>
                <span className="p-icon" aria-hidden="true">
                  <PanelIcon name={wardenPanel.lucideIcon} size={15} />
                </span>
                <span className="p-label">{wardenPanel.label}</span>
                <span className={`p-count ${hot ? 'hot' : ''}`}>{list.length}</span>
              </div>
              <div className="panel-body" style={{ maxHeight: 'none' }}>
                {list.length === 0 && (
                  <div className="empty-state">
                    <span className="empty-text">No active reports</span>
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
        })()}

        {/* Recently closed */}
        {closed.length > 0 && (
          <section className="closed-section">
            <div className="closed-head">
              Recently closed ({closed.length})
              <span style={{ flex: 1 }} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setIncidents((prev) => prev.filter((i) => i.status === 'active' || i.status === 'acknowledged'))}
                style={{ fontSize: 11 }}
              >
                Clear closed
              </button>
            </div>
            <div className="card closed-list">
              {closed.slice(0, 12).map((i) => (
                <div className="closed-row" key={i.id}>
                  <strong className="c-area">{i.area}</strong>
                  <span className="c-meta">
                    {i.report_count} report{i.report_count === 1 ? '' : 's'} · {i.type}
                  </span>
                  <span className="c-time tabnum">
                    {fmtTime(i.resolved_at || i.created_at)}
                  </span>
                  <StatusChip status={i.status} />
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="board-footnote">
          Demo build · no external services contacted.
        </div>
      </main>

      {shareOpen && <ShareQR onClose={() => setShareOpen(false)} />}
      <Toasts toasts={toasts} />
    </div>
  );
}
