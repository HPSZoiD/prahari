// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE ONLY — in-browser mock of the tiny Supabase surface this app uses.
// Loaded exclusively via dynamic import when VITE_PRDH_DEMO=1 (never bundled
// into production builds). It mirrors the exact semantics of
// supabase/schema.sql so rehearsal behaviour matches the real system:
//   • grouping by open (type, area) with report_count — 'Unspecified' is a
//     reserved bucket when no area was picked
//   • dedupe via one active report per session
//   • cancel only pre-ack, auto-cancel at 0 reports
//   • location refine + ownership checks
// Realtime is emulated with BroadcastChannel: open student + command in two
// tabs of the same browser and they sync live.
// ─────────────────────────────────────────────────────────────────────────────

const DB_KEY = 'prahari_mock_db_v1';
const AUTH_KEY = 'prahari_mock_auth_v1';
const BUS_NAME = 'prahari_mock_bus_v1';

const TAB_ID = Math.random().toString(36).slice(2);

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'm' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const nowIso = () => new Date().toISOString();

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted — start fresh */ }
  return { incidents: [], sos_events: [], incident_log: [] };
}
function saveDb(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function readAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}

// ── change bus (BroadcastChannel → other tabs) ───────────────────────────────
let bus = null;
const channels = new Set();
const authListeners = new Set();

function getBus() {
  if (bus === null) {
    try { bus = new BroadcastChannel(BUS_NAME); } catch { bus = false; }
  }
  return bus || null;
}

function wireBusOnce() {
  const b = getBus();
  if (!b || b._wired) return;
  b._wired = true;
  b.onmessage = (msg) => {
    const { source, table, eventType, row } = msg.data || {};
    if (!table || source === TAB_ID) return;
    emit(table, eventType, row);
  };
}

function emit(table, eventType, row) {
  const payload = { schema: 'public', table, eventType, new: row, old: null, errors: [] };
  for (const ch of channels) {
    for (const h of ch.handlers) {
      if (h.table !== table) continue;
      if (h.eventType !== '*' && h.eventType !== eventType) continue;
      if (h.filterKey && row && row[h.filterKey] !== h.filterValue) continue;
      try { h.cb(payload); } catch (e) { console.error('[mock] handler error', e); }
    }
  }
}

function announce(table, eventType, row) {
  emit(table, eventType, row);
  const b = getBus();
  if (b) { try { b.postMessage({ source: TAB_ID, table, eventType, row }); } catch { /* ignore */ } }
}

// ── RPC implementations (mirror supabase/schema.sql) ─────────────────────────
const UNSPECIFIED = 'Unspecified';

function raiseSos(db, a) {
  if (!a.p_session) return { error: 'session id is required' };
  if (!['medical', 'fire', 'safety'].includes(a.p_type)) return { error: `invalid SOS type: ${a.p_type}` };

  // Area resolution (mirrors raise_sos): manual selection or the reserved
  // 'Unspecified' bucket. NEVER falls back to hostel or GPS.
  const hasArea = a.p_area != null && String(a.p_area).trim() !== '';
  const area = hasArea ? String(a.p_area).trim() : UNSPECIFIED;
  const locationSource = hasArea ? 'manual' : 'unspecified';

  // dedupe: one active report per session
  const prevEvent = db.sos_events.find((e) => e.session_id === a.p_session && e.status === 'active');
  if (prevEvent) {
    const prevInc = db.incidents.find((i) => i.id === prevEvent.incident_id);
    if (prevInc && (prevInc.status === 'active' || prevInc.status === 'acknowledged')) {
      return {
        incident_id: prevInc.id, event_id: prevEvent.id,
        report_count: prevInc.report_count, status: prevInc.status,
        area: prevInc.area, location_source: prevEvent.location_source, deduped: true,
      };
    }
    prevEvent.status = 'cancelled';
    db.incident_log.push({
      id: uid(), incident_id: prevInc.id, event: 'cancelled',
      actor: `student:${a.p_session}`, ts: nowIso(),
      meta: { reason: 'stale_event_closed_on_new_sos', event_id: prevEvent.id },
    });
    announce('sos_events', 'UPDATE', prevEvent);
  }

  // find-or-create the open incident for (type, area)
  let inc = db.incidents.find(
    (i) => i.type === a.p_type && i.area === area &&
      (i.status === 'active' || i.status === 'acknowledged'));
  let created = false;
  if (inc) {
    inc.report_count += 1;
    inc.last_report_at = nowIso();
  } else {
    inc = {
      id: uid(), type: a.p_type, area, status: 'active', report_count: 1,
      created_at: nowIso(), last_report_at: nowIso(),
      ack_at: null, ack_by: null, resolved_at: null, resolution_note: null,
    };
    db.incidents.push(inc);
    created = true;
  }

  const ev = {
    id: uid(), incident_id: inc.id, session_id: a.p_session,
    name: String(a.p_name || '').trim().slice(0, 80),
    roll: String(a.p_roll || '').trim().slice(0, 40),
    phone: a.p_phone ? String(a.p_phone).trim().slice(0, 20) : null,
    hostel: a.p_hostel ? String(a.p_hostel).trim().slice(0, 60) : null,
    room: a.p_room ? String(a.p_room).trim().slice(0, 40) : null,
    area, type: a.p_type,
    lat: a.p_lat ?? null, lng: a.p_lng ?? null, accuracy_m: a.p_acc ?? null,
    location_status: (a.p_lat == null || a.p_lng == null) ? 'unavailable' : 'approximate',
    location_source: locationSource,
    silent: a.p_silent == null ? true : !!a.p_silent,
    status: 'active', created_at: nowIso(),
  };
  db.sos_events.push(ev);

  db.incident_log.push({
    id: uid(), incident_id: inc.id,
    event: created ? 'created' : 'report_added',
    actor: `student:${a.p_session}`, ts: nowIso(),
    meta: { event_id: ev.id, type: a.p_type, area, location_source: locationSource },
  });

  const result = {
    incident_id: inc.id, event_id: ev.id,
    report_count: inc.report_count, status: inc.status,
    area, location_source: locationSource,
  };
  return { result, incidentRow: inc, eventRow: ev, created };
}

function cancelSos(db, a) {
  const ev = db.sos_events.find(
    (e) => e.id === a.p_event && e.session_id === a.p_session && e.status === 'active');
  if (!ev) return { result: { ok: false, reason: 'event_not_active' } };
  const inc = db.incidents.find((i) => i.id === ev.incident_id);
  if (!inc || inc.status !== 'active') {
    return { result: { ok: false, reason: 'already_acknowledged', incident_status: inc?.status } };
  }
  ev.status = 'cancelled';
  inc.report_count = Math.max(inc.report_count - 1, 0);
  if (inc.report_count <= 0) inc.status = 'cancelled';
  db.incident_log.push({
    id: uid(), incident_id: inc.id, event: 'cancelled',
    actor: `student:${a.p_session}`, ts: nowIso(),
    meta: { event_id: ev.id, reports_remaining: inc.report_count },
  });
  return { result: { ok: true, incident_status: inc.status, report_count: inc.report_count }, eventRow: ev, incidentRow: inc };
}

function updateLocation(db, a) {
  const ev = db.sos_events.find(
    (e) => e.id === a.p_event && e.session_id === a.p_session && e.status === 'active');
  if (!ev) return { result: { ok: false, reason: 'event_not_active' } };
  ev.lat = a.p_lat; ev.lng = a.p_lng; ev.accuracy_m = a.p_acc;
  ev.location_status = (a.p_acc != null && a.p_acc <= 50) ? 'precise' : 'approximate';
  db.incident_log.push({
    id: uid(), incident_id: ev.incident_id, event: 'location_updated',
    actor: `student:${a.p_session}`, ts: nowIso(),
    meta: { event_id: ev.id, lat: a.p_lat, lng: a.p_lng, accuracy_m: a.p_acc, location_status: ev.location_status },
  });
  return { result: { ok: true, location_status: ev.location_status }, eventRow: ev };
}

// ── query builder (the exact subset the app uses) ────────────────────────────
function makeBuilder(table) {
  const state = { filters: [], order: null, limit: null, update: null };
  const b = {
    select() { return b; },
    eq(col, val) { state.filters.push({ kind: 'eq', col, val }); return b; },
    in(col, vals) { state.filters.push({ kind: 'in', col, vals }); return b; },
    order(col, opts = {}) { state.order = { col, asc: !!opts.ascending }; return b; },
    limit(n) { state.limit = n; return b; },
    update(patch) { state.update = patch; return b; },
    then(onOk, onErr) { return exec().then(onOk, onErr); },
  };
  async function exec() {
    const db = loadDb();
    let rows = (db[table] || []).slice();
    for (const f of state.filters) {
      rows = rows.filter((r) =>
        f.kind === 'eq' ? r[f.col] === f.val : f.vals.includes(r[f.col]));
    }
    if (state.order) {
      const { col, asc } = state.order;
      rows.sort((x, y) => {
        const a = x[col], c = y[col];
        const cmp = a < c ? -1 : a > c ? 1 : 0;
        return asc ? cmp : -cmp;
      });
    }
    if (state.limit != null) rows = rows.slice(0, state.limit);
    if (state.update) {
      const db2 = loadDb();
      const updated = [];
      for (const r of rows) {
        const idx = db2[table].findIndex((x) => x.id === r.id);
        if (idx >= 0) {
          db2[table][idx] = { ...db2[table][idx], ...state.update };
          updated.push(db2[table][idx]);
        }
      }
      saveDb(db2);
      for (const u of updated) announce(table, 'UPDATE', u);
      return { data: updated, error: null };
    }
    return { data: rows, error: null };
  }
  return b;
}

// ── the mock client ──────────────────────────────────────────────────────────
export function createMockClient() {
  wireBusOnce();
  return {
    __demo: true,

    rpc(name, args) {
      const db = loadDb();
      let out;
      if (name === 'raise_sos') {
        out = raiseSos(db, args);
        if (out.error) return Promise.resolve({ data: null, error: { message: out.error } });
        saveDb(db);
        announce('incidents', out.created ? 'INSERT' : 'UPDATE', out.incidentRow);
        announce('sos_events', 'INSERT', out.eventRow);
        return Promise.resolve({ data: out.result, error: null });
      }
      if (name === 'cancel_sos') {
        out = cancelSos(db, args);
        if (out.error) return Promise.resolve({ data: null, error: { message: out.error } });
        saveDb(db);
        announce('sos_events', 'UPDATE', out.eventRow);
        announce('incidents', 'UPDATE', out.incidentRow);
        return Promise.resolve({ data: out.result, error: null });
      }
      if (name === 'update_sos_location') {
        out = updateLocation(db, args);
        if (out.error) return Promise.resolve({ data: null, error: { message: out.error } });
        saveDb(db);
        announce('sos_events', 'UPDATE', out.eventRow);
        return Promise.resolve({ data: out.result, error: null });
      }
      if (name === 'reset_drill') {
        const auth = readAuth();
        if (!auth) return Promise.resolve({ data: null, error: { message: 'reset_drill: command only' } });
        saveDb({ incidents: [], sos_events: [], incident_log: [] });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `[mock] unknown rpc: ${name}` } });
    },

    from(table) { return makeBuilder(table); },

    channel(name) {
      const ch = {
        name, handlers: [],
        on(kind, opts, cb) {
          if (kind === 'postgres_changes') {
            const { event, table: t, filter } = opts || {};
            let filterKey = null, filterValue = null;
            if (typeof filter === 'string' && filter.includes('=')) {
              const [col, val] = filter.split('=');
              if (val.startsWith('eq.')) { filterKey = col; filterValue = val.slice(3); }
            }
            ch.handlers.push({ eventType: event || '*', table: t, filterKey, filterValue, cb });
          }
          return ch;
        },
        subscribe(statusCb) {
          channels.add(ch);
          wireBusOnce();
          setTimeout(() => statusCb && statusCb('SUBSCRIBED'), 60);
          return ch;
        },
        unsubscribe() { channels.delete(ch); return Promise.resolve('ok'); },
      };
      return ch;
    },
    removeChannel(ch) { channels.delete(ch); return Promise.resolve('ok'); },

    auth: {
      async signInWithPassword({ email, password }) {
        if (!email || !password) {
          return { data: { session: null }, error: { message: 'Enter the demo email and any password (mock accepts anything).' } };
        }
        const session = { user: { email, id: uid() } };
        localStorage.setItem(AUTH_KEY, JSON.stringify(session));
        for (const cb of authListeners) cb('SIGNED_IN', session);
        return { data: { session, user: session.user }, error: null };
      },
      async signOut() {
        localStorage.removeItem(AUTH_KEY);
        for (const cb of authListeners) cb('SIGNED_OUT', null);
        return { error: null };
      },
      async getSession() { return { data: { session: readAuth() }, error: null }; },
      async getUser() { return { data: { user: readAuth()?.user ?? null }, error: null }; },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        setTimeout(() => cb(readAuth() ? 'SIGNED_IN' : 'INITIAL_SESSION', readAuth()), 0);
        return { data: { subscription: { unsubscribe() { authListeners.delete(cb); } } } };
      },
    },
  };
}
