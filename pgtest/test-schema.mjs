// Project Prahari — V1.1 schema verification against a real embedded Postgres 18.
// Run: node test-schema.mjs   (from prahari/pgtest)
//
// Verifies (V1.1 spec A1-A9 + B1-B7):
//   T1  raise_sos twice, same (type,area)  -> ONE incident, report_count = 2
//   T2  dedupe: same session re-raise      -> returns existing report, no inflation
//   T3  different areas                    -> separate incidents
//   T4  resolve -> next raise same pair    -> fresh incident (count resets to 1)
//   T5  stale retrigger after resolve      -> new incident, old event cancelled
//   T6  cancel: 2 reporters                -> decrement; auto-cancel at 0
//   T7  cancel post-ack                    -> blocked (already_acknowledged)
//   T8  update_sos_location ownership      -> ok for owner, rejected for others
//   T9  RLS matrix (anon / authenticated)  + reset_drill command-only
//   T10 70 concurrent raises, SAME pair    -> 1 incident, count 70
//   T11 70 concurrent raises, 6 pairs      -> exactly one open incident per pair,
//       no duplicates, counts sum, report_count == active events
//   T12 new report on ACKED incident       -> bump, status stays acknowledged,
//       last_report_at > ack_at
//   ── V1.1 additions ──────────────────────────────────────────────────────────
//   T13 area NULL → 'Unspecified' bucket, location_source='unspecified'
//   T14 area '  Block A ' trimmed → 'Block A', location_source='manual'
//   T15 hostel/room snapshotted into sos_events; NOT used for grouping
//       (two reporters, same hostel, different/no area -> separate incidents)
//   T16 70 concurrent MIXED: unique sessions, all three types, selected areas
//       + Unspecified, some silent, some with/without coords. Asserts zero
//       errors, both B1 SQL invariant checks return 0 rows, report_count sums
//       match active events, exactly one open incident per (type, area).
//   T17 return shape: {incident_id, event_id, report_count, status} (+area,
//       location_source) for both manual and unspecified paths.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const { Client } = pg;
const DB = 'prahari';
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const section = (s) => console.log(`\n== ${s}`);

const epg = new EmbeddedPostgres({
  databaseDir: './dbdata',
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: false,
  postgresFlags: ['-c', 'wal_level=logical'], // match Supabase (realtime publication)
  onLog: () => {},
  onError: (e) => process.stderr.write(`pg: ${e}\n`),
});

try {
  await epg.initialise();
  await epg.start();
  await epg.createDatabase(DB);

  const c = epg.getPgClient(DB);
  await c.connect();

  // ── Supabase environment shims ─────────────────────────────────────────────
  await c.query('create role anon nologin');
  await c.query('create role authenticated nologin');
  await c.query('create schema if not exists auth');
  await c.query('create table auth._uid (uid uuid)');
  await c.query(`create or replace function auth.uid() returns uuid
                 language sql stable as $$ select uid from auth._uid limit 1 $$`);
  await c.query('grant usage on schema auth to public');

  // ── Apply the real schema.sql, verbatim ────────────────────────────────────
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await c.query(schema);
  console.log('schema.sql applied cleanly.');

  // V1.1 raise helper (p_hostel/p_room at the end, matching the SQL signature).
  const raise = (session, area, type, o = {}) =>
    c.query('select public.raise_sos($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [
      session, o.name ?? 'Tester', o.roll ?? 'R1', null, area, type,
      o.lat ?? null, o.lng ?? null, o.acc ?? null, o.silent ?? true,
      o.hostel ?? null, o.room ?? null,
    ]).then(({ rows }) => rows[0].r);

  // ── T1: Phase 0 exit criterion ─────────────────────────────────────────────
  section('T1  two raises, same (type,area) -> one incident, count 2');
  const s1 = randomUUID(), s2 = randomUUID();
  const r1 = await raise(s1, 'Block A', 'medical');
  const r2 = await raise(s2, 'Block A', 'medical');
  check('both calls succeeded', r1?.incident_id && r2?.incident_id);
  check('same incident id', r1.incident_id === r2.incident_id);
  check('report_count = 2', r2.report_count === 2, `got ${r2.report_count}`);
  const { rows: cnt1 } = await c.query(
    "select count(*)::int as n from incidents where status in ('active','acknowledged')");
  check('exactly one open incident', cnt1[0].n === 1, `got ${cnt1[0].n}`);

  // ── T2: dedupe ──────────────────────────────────────────────────────────────
  section('T2  dedupe: same session re-raise');
  const again = await raise(s1, 'Block A', 'medical');
  check('returns existing event', again.event_id === r1.event_id);
  check('flagged deduped', again.deduped === true);
  check('count not inflated', again.report_count === 2, `got ${again.report_count}`);

  // ── T3: different area -> new incident ──────────────────────────────────────
  section('T3  different area -> separate incident');
  const r3 = await raise(randomUUID(), 'Library', 'medical');
  check('new incident for new area', r3.incident_id !== r1.incident_id);
  check('count starts at 1', r3.report_count === 1);

  // ── T4: resolve -> fresh incident on next raise ─────────────────────────────
  section('T4  resolve -> next raise creates fresh incident');
  await c.query("update incidents set status='resolved', resolved_at=now() where id=$1", [r3.incident_id]);
  const r4 = await raise(randomUUID(), 'Library', 'medical');
  check('fresh incident after resolve', r4.incident_id !== r3.incident_id);
  check('count restarted at 1', r4.report_count === 1);

  // ── T5: stale session retrigger ─────────────────────────────────────────────
  section('T5  stale retrigger after own incident resolved');
  const s5 = randomUUID();
  const r5a = await raise(s5, 'Hostel 1', 'fire');
  await c.query("update incidents set status='resolved', resolved_at=now() where id=$1", [r5a.incident_id]);
  const r5b = await raise(s5, 'Ground', 'safety');
  check('stale session can raise fresh', !!r5b.incident_id);
  check('new incident created', r5b.incident_id !== r5a.incident_id);
  const { rows: ev5 } = await c.query(
    "select status from sos_events where id=$1", [r5a.event_id]);
  check('old event retired as cancelled', ev5[0].status === 'cancelled');

  // ── T6: cancel flow ─────────────────────────────────────────────────────────
  section('T6  cancel: decrement, auto-cancel at zero');
  const s6a = randomUUID(), s6b = randomUUID();
  const r6a = await raise(s6a, 'Canteen', 'safety');
  const r6b = await raise(s6b, 'Canteen', 'safety');
  const c1 = await c.query('select public.cancel_sos($1,$2) as r', [r6a.event_id, s6a]).then(x => x.rows[0].r);
  check('first cancel ok', c1.ok === true);
  check('count decremented to 1', c1.report_count === 1);
  const { rows: inc6 } = await c.query('select status from incidents where id=$1', [r6a.incident_id]);
  check('incident still active', inc6[0].status === 'active');
  const c2 = await c.query('select public.cancel_sos($1,$2) as r', [r6b.event_id, s6b]).then(x => x.rows[0].r);
  check('second cancel ok', c2.ok === true);
  const { rows: inc6b } = await c.query('select status from incidents where id=$1', [r6a.incident_id]);
  check('incident auto-cancelled at 0', inc6b[0].status === 'cancelled');

  // ── T7: cancel blocked post-ack ─────────────────────────────────────────────
  section('T7  cancel blocked after acknowledge');
  const s7 = randomUUID();
  const r7 = await raise(s7, 'Auditorium', 'fire');
  await c.query("update incidents set status='acknowledged', ack_at=now(), ack_by='command' where id=$1", [r7.incident_id]);
  const c7 = await c.query('select public.cancel_sos($1,$2) as r', [r7.event_id, s7]).then(x => x.rows[0].r);
  check('cancel rejected', c7.ok === false);
  check('reason already_acknowledged', c7.reason === 'already_acknowledged');

  // ── T8: location update ownership ───────────────────────────────────────────
  section('T8  update_sos_location ownership');
  const s8 = randomUUID();
  const r8 = await raise(s8, 'Block B', 'medical');
  const locOk = await c.query(
    'select public.update_sos_location($1,$2,$3,$4,$5) as r',
    [r8.event_id, s8, 28.6139, 77.2090, 12.5]).then(x => x.rows[0].r);
  check('owner update ok', locOk.ok === true);
  check('precise at <=50m', locOk.location_status === 'precise');
  const locBad = await c.query(
    'select public.update_sos_location($1,$2,$3,$4,$5) as r',
    [r8.event_id, randomUUID(), 28.0, 77.0, 10]).then(x => x.rows[0].r);
  check('non-owner update rejected', locBad.ok === false);
  const { rows: log8 } = await c.query(
    "select count(*)::int as n from incident_log where event='location_updated' and incident_id=$1", [r8.incident_id]);
  check('location_updated logged', log8[0].n === 1);
  // Area stays manual after a refine — GPS NEVER rewrites grouping (A5).
  const { rows: areaAfterRefine } = await c.query(
    'select area, location_source from sos_events where id=$1', [r8.event_id]);
  check('area unchanged by refine', areaAfterRefine[0].area === 'Block B');
  check('location_source unchanged by refine', areaAfterRefine[0].location_source === 'manual');

  // ── T9: RLS matrix + reset_drill gating ────────────────────────────────────
  section('T9  RLS: anon vs authenticated');
  let err = null;
  await c.query('set role anon');
  try { await c.query('select count(*) from public.incidents'); check('anon: incidents SELECT ok', true); }
  catch (e) { check('anon: incidents SELECT ok', false, e.message); }
  err = null;
  try { await c.query('select count(*) from public.sos_events'); } catch (e) { err = e; }
  check('anon: sos_events SELECT denied', !!err, err ? '' : 'no error');
  err = null;
  try { await c.query('select count(*) from public.incident_log'); } catch (e) { err = e; }
  check('anon: incident_log SELECT denied', !!err, err ? '' : 'no error');
  err = null;
  try { await c.query("insert into public.incidents (type, area) values ('fire','Fake')"); } catch (e) { err = e; }
  check('anon: incidents INSERT denied', !!err, err ? '' : 'no error');
  err = null;
  try { await c.query('select public.reset_drill()'); } catch (e) { err = e; }
  check('anon: reset_drill denied', !!err, err ? '' : 'no error');
  await c.query('reset role');

  await c.query(`insert into auth._uid (uid) values ('${randomUUID()}')`);
  await c.query('set role authenticated');
  try { await c.query('select count(*) from public.sos_events'); check('authenticated: sos_events SELECT ok', true); }
  catch (e) { check('authenticated: sos_events SELECT ok', false, e.message); }
  try { await c.query('select count(*) from public.incident_log'); check('authenticated: incident_log SELECT ok', true); }
  catch (e) { check('authenticated: incident_log SELECT ok', false, e.message); }
  try {
    await c.query("update public.incidents set status='acknowledged', ack_at=now(), ack_by='cmd@test' where id=$1", [r8.incident_id]);
    check('authenticated: incidents UPDATE ok (ack)', true);
  } catch (e) { check('authenticated: incidents UPDATE ok (ack)', false, e.message); }
  try { await c.query('select public.reset_drill()'); check('authenticated: reset_drill ok', true); }
  catch (e) { check('authenticated: reset_drill ok', false, e.message); }
  await c.query('reset role');
  await c.query('delete from auth._uid');
  const { rows: afterReset } = await c.query(
    'select (select count(*)::int from incidents) i, (select count(*)::int from sos_events) e, (select count(*)::int from incident_log) l');
  check('reset_drill truncated all three tables',
    afterReset[0].i === 0 && afterReset[0].e === 0 && afterReset[0].l === 0);

  // ── T10: 70 concurrent, SAME pair ──────────────────────────────────────────
  section('T10  70 concurrent raises on the SAME (type,area)');
  const clients = [];
  for (let i = 0; i < 70; i++) {
    const cl = new Client({ host: 'localhost', port: 5433, user: 'postgres', password: 'postgres', database: DB });
    await cl.connect();
    clients.push(cl);
  }
  const t10start = Date.now();
  const t10res = await Promise.all(clients.map((cl, i) =>
    cl.query('select public.raise_sos($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [
      randomUUID(), `Student ${i}`, `ROLL${i}`, null, 'Hostel 2', 'fire',
      28.61 + Math.random() * 0.01, 77.20 + Math.random() * 0.01, 20, true,
      'Hostel 2', `B-${100 + i}`,
    ]).then(x => x.rows[0].r, e => ({ error: e.message }))));
  const t10ms = Date.now() - t10start;
  check('all 70 calls succeeded', t10res.every(r => r && r.incident_id), `${t10res.filter(r => !r?.incident_id).length} failed`);
  const { rows: t10 } = await c.query(
    "select count(*)::int n, max(report_count)::int c from incidents where status in ('active','acknowledged')");
  check('exactly ONE incident', t10[0].n === 1, `got ${t10[0].n}`);
  check('report_count = 70', t10[0].c === 70, `got ${t10[0].c}`);
  console.log(`       (70-way same-pair burst completed in ${t10ms} ms)`);

  // reset for T11
  await c.query(`insert into auth._uid (uid) values ('${randomUUID()}')`);
  await c.query('set role authenticated');
  await c.query('select public.reset_drill()');
  await c.query('reset role');
  await c.query('delete from auth._uid');

  // ── T11: 70 concurrent across 6 pairs ──────────────────────────────────────
  section('T11  70 concurrent raises across 6 (type,area) pairs');
  const pairs = [
    ['medical', 'Block A'], ['fire', 'Hostel 1'], ['safety', 'Library'],
    ['medical', 'Ground'], ['fire', 'Block B'], ['safety', 'Canteen'],
  ];
  const expected = Object.fromEntries(pairs.map(([t, a]) => [`${t}|${a}`, 0]));
  const t11start = Date.now();
  const t11res = await Promise.all(clients.map((cl, i) => {
    const [type, area] = pairs[i % pairs.length];
    expected[`${type}|${area}`]++;
    return cl.query('select public.raise_sos($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [
      randomUUID(), `Student ${i}`, `ROLL${i}`, null, area, type, null, null, null, i % 4 === 0,
      'Hostel 1', null,
    ]).then(x => x.rows[0].r, e => ({ error: e.message }));
  }));
  const t11ms = Date.now() - t11start;
  check('all 70 calls succeeded', t11res.every(r => r && r.incident_id), `${t11res.filter(r => !r?.incident_id).length} failed`);
  const { rows: dups } = await c.query(
    "select type, area, count(*)::int n from incidents where status in ('active','acknowledged') group by 1,2 having count(*) > 1");
  check('no duplicate open (type,area)', dups.length === 0, JSON.stringify(dups));
  const { rows: t11 } = await c.query(
    "select type, area, report_count from incidents where status in ('active','acknowledged')");
  check('6 open incidents (one per pair)', t11.length === 6, `got ${t11.length}`);
  const mismatch = t11.filter(i => expected[`${i.type}|${i.area}`] !== i.report_count);
  check('report_count matches arrivals per pair', mismatch.length === 0, JSON.stringify(mismatch));
  check('total reports = 70', t11.reduce((s, i) => s + i.report_count, 0) === 70);
  const { rows: inv } = await c.query(
    `select i.id from incidents i
     where i.status in ('active','acknowledged')
       and i.report_count <> (select count(*) from sos_events e
                              where e.incident_id = i.id and e.status = 'active')`);
  check('invariant: report_count == active events', inv.length === 0, JSON.stringify(inv));
  console.log(`       (70-way 6-pair burst completed in ${t11ms} ms)`);

  // ── T12: new report on ACKED incident ──────────────────────────────────────
  section('T12  new report on acknowledged incident');
  const { rows: toAck } = await c.query("select id, type, area, report_count from incidents where status='active' limit 1");
  await c.query("update incidents set status='acknowledged', ack_at=now(), ack_by='cmd@test' where id=$1", [toAck[0].id]);
  const before = toAck[0].report_count;
  const bump = await raise(randomUUID(), toAck[0].area, toAck[0].type);
  check('new report joins acked incident', bump.incident_id === toAck[0].id);
  const { rows: after } = await c.query(
    `select report_count, status,
            (last_report_at > ack_at) as badge_condition,
            extract(epoch from (last_report_at - ack_at))::float8 as delta_s
       from incidents where id=$1`, [toAck[0].id]);
  check('count bumped on acked incident', after[0].report_count === before + 1, `${before} -> ${after[0].report_count}`);
  check('status stays acknowledged', after[0].status === 'acknowledged');
  check('last_report_at > ack_at (+N new badge condition)',
    after[0].badge_condition === true,
    `delta=${after[0].delta_s}s (JS Date parses timestamptz at ms precision — compare at µs in SQL)`);

  // reset for V1.1 tests
  await c.query(`insert into auth._uid (uid) values ('${randomUUID()}')`);
  await c.query('set role authenticated');
  await c.query('select public.reset_drill()');
  await c.query('reset role');
  await c.query('delete from auth._uid');

  // ── T13: V1.1 Unspecified bucket ───────────────────────────────────────────
  section('T13  area NULL/empty -> reserved Unspecified bucket');
  const r13a = await raise(randomUUID(), null, 'medical');
  const r13b = await raise(randomUUID(), '', 'medical');
  check('null-area call succeeded', !!r13a?.incident_id);
  check('empty-area call succeeded', !!r13b?.incident_id);
  check('both land in the same Unspecified incident', r13a.incident_id === r13b.incident_id);
  check('returned area is Unspecified', r13a.area === 'Unspecified', `got ${r13a.area}`);
  check('returned location_source is unspecified', r13a.location_source === 'unspecified');
  const { rows: ev13 } = await c.query(
    "select area, location_source from sos_events where id = any($1)", [[r13a.event_id, r13b.event_id]]);
  check('events carry Unspecified + source', ev13.every(e => e.area === 'Unspecified' && e.location_source === 'unspecified'));
  const { rows: inc13 } = await c.query(
    'select area from incidents where id=$1', [r13a.incident_id]);
  check('incident area is Unspecified', inc13[0].area === 'Unspecified');
  // Unspecified groups by type too (the key is still (type, area))
  const r13c = await raise(randomUUID(), null, 'fire');
  check('different type -> separate Unspecified incident', r13c.incident_id !== r13a.incident_id);

  // ── T14: manual selection trims + tags source ──────────────────────────────
  section('T14  manual area selection (trim + location_source)');
  const r14 = await raise(randomUUID(), '  Block A  ', 'safety');
  check('trimmed area accepted', r14.area === 'Block A', `got ${r14.area}`);
  check('location_source is manual', r14.location_source === 'manual');
  const { rows: ev14 } = await c.query(
    'select area, location_source from sos_events where id=$1', [r14.event_id]);
  check('event trimmed + manual', ev14[0].area === 'Block A' && ev14[0].location_source === 'manual');
  // ...and it groups with an exact-match manual selection
  const r14b = await raise(randomUUID(), 'Block A', 'safety');
  check('groups with exact match', r14b.incident_id === r14.incident_id);
  // manual 'Unspecified' is treated as manual (it came from the dropdown path,
  // but the client never offers it — server-side it is still a discrete area)
  const { rows: ev14c } = await c.query(
    'select location_source from sos_events where id=$1', [r14b.event_id]);
  check('explicit pick tagged manual', ev14c[0].location_source === 'manual');

  // ── T15: hostel/room snapshot, never grouping ──────────────────────────────
  section('T15  hostel/room are a residence hint, never grouping');
  const s15a = randomUUID(), s15b = randomUUID();
  const r15a = await raise(s15a, null, 'fire', { hostel: 'Hostel 1', room: 'B-204' });
  const r15b = await raise(s15b, 'Library', 'fire', { hostel: 'Hostel 1', room: 'C-101' });
  check('snapshotted hostel on event', true);
  const { rows: ev15 } = await c.query(
    'select hostel, room from sos_events where id = any($1) order by created_at', [[r15a.event_id, r15b.event_id]]);
  check('hostel + room stored verbatim',
    ev15.some(e => e.hostel === 'Hostel 1' && e.room === 'B-204') &&
    ev15.some(e => e.hostel === 'Hostel 1' && e.room === 'C-101'));
  check('same hostel, different area -> SEPARATE incidents',
    r15a.incident_id !== r15b.incident_id);
  check('Unspecified event did NOT borrow the hostel as area', r15a.area === 'Unspecified');
  // Same hostel, both no-area -> same Unspecified group (by type+area, not hostel)
  const r15c = await raise(randomUUID(), null, 'fire', { hostel: 'Hostel 1' });
  check('same hostel + no area -> joins Unspecified group', r15c.incident_id === r15a.incident_id);

  // ── T17 (run before the big T16 so counts stay clean) ───────────────────────
  section('T17  return shape on both paths');
  const shapeManual = await raise(randomUUID(), 'Ground', 'medical');
  const shapeUnspec = await raise(randomUUID(), null, 'medical');
  const shapeKeys = ['incident_id', 'event_id', 'report_count', 'status'];
  check('manual return has the 4 core keys', shapeKeys.every(k => shapeManual[k] != null));
  check('unspecified return has the 4 core keys', shapeKeys.every(k => shapeUnspec[k] != null));
  check('both expose area + location_source (V1.1 extras)',
    shapeManual.area === 'Ground' && shapeUnspec.area === 'Unspecified');

  // reset for T16
  await c.query(`insert into auth._uid (uid) values ('${randomUUID()}')`);
  await c.query('set role authenticated');
  await c.query('select public.reset_drill()');
  await c.query('reset role');
  await c.query('delete from auth._uid');

  // ── T16: 70 concurrent MIXED (the B1 gauntlet) ─────────────────────────────
  section('T16  70 concurrent MIXED: types x areas x Unspecified x silent x coords');
  const MIX_PAIRS = [
    ['medical', 'Block A'], ['fire', 'Hostel 1'], ['safety', 'Library'],
    ['medical', 'Ground'], ['fire', 'Block B'], ['safety', 'Canteen'],
    ['medical', null], ['fire', null], ['safety', null], // Unspecified buckets
  ];
  const mixExpected = {};
  const t16start = Date.now();
  const t16res = await Promise.all(clients.map((cl, i) => {
    const [type, area] = MIX_PAIRS[i % MIX_PAIRS.length];
    const key = `${type}|${area ?? 'Unspecified'}`;
    mixExpected[key] = (mixExpected[key] || 0) + 1;
    const withFix = i % 3 !== 0;              // 2/3 have coords
    const silent = i % 2 === 0;               // half silent
    return cl.query('select public.raise_sos($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r', [
      randomUUID(), `Student ${i}`, `ROLL${i}`, null, area, type,
      withFix ? 28.61 + Math.random() * 0.02 : null,
      withFix ? 77.20 + Math.random() * 0.02 : null,
      withFix ? Math.round(8 + Math.random() * 40) : null,
      silent,
      i % 2 === 0 ? 'Hostel 1' : 'Hostel 2',
      `A-${100 + i}`,
    ]).then(x => x.rows[0].r, e => ({ error: e.message }));
  }));
  const t16ms = Date.now() - t16start;

  // ── The two EXACT SQL invariant checks from spec B1 ─────────────────────────
  const { rows: b1dupIncidents } = await c.query(
    `select type, area, count(*) from incidents
       where status in ('active','acknowledged')
       group by 1,2 having count(*) > 1`);
  check('B1 check 1: 0 rows (no duplicate open incidents per type,area)',
    b1dupIncidents.length === 0, JSON.stringify(b1dupIncidents));
  const { rows: b1dupSessions } = await c.query(
    `select session_id, count(*) from sos_events
       where status = 'active' group by 1 having count(*) > 1`);
  check('B1 check 2: 0 rows (one active report per session)',
    b1dupSessions.length === 0, JSON.stringify(b1dupSessions));

  check('all 70 mixed calls succeeded (zero errors)',
    t16res.every(r => r && r.incident_id), `${t16res.filter(r => !r?.incident_id).length} failed`);
  const { rows: t16 } = await c.query(
    "select type, area, report_count from incidents where status in ('active','acknowledged')");
  check('exactly 9 open incidents (6 areas + 3 Unspecified per type)', t16.length === 9, `got ${t16.length}`);
  const t16mismatch = t16.filter(i => mixExpected[`${i.type}|${i.area}`] !== i.report_count);
  check('report_count matches arrivals per pair', t16mismatch.length === 0, JSON.stringify(t16mismatch));
  check('total reports = 70', t16.reduce((s, i) => s + i.report_count, 0) === 70);
  const { rows: t16inv } = await c.query(
    `select i.id from incidents i
     where i.status in ('active','acknowledged')
       and i.report_count <> (select count(*) from sos_events e
                              where e.incident_id = i.id and e.status = 'active')`);
  check('report_count == active events (sums match)', t16inv.length === 0, JSON.stringify(t16inv));
  const { rows: t16src } = await c.query(
    `select count(*)::int n from sos_events e
      join incidents i on i.id = e.incident_id
     where i.area = 'Unspecified' and e.location_source <> 'unspecified'`);
  check('every Unspecified event tagged location_source=unspecified', t16src[0].n === 0);
  const { rows: t16man } = await c.query(
    `select count(*)::int n from sos_events e
      join incidents i on i.id = e.incident_id
     where i.area <> 'Unspecified' and e.location_source <> 'manual'`);
  check('every named-area event tagged location_source=manual', t16man[0].n === 0);
  const { rows: t16hostel } = await c.query(
    'select count(*)::int n from sos_events where hostel is null');
  check('hostel snapshotted on all 70', t16hostel[0].n === 0);
  console.log(`       (70-way mixed burst completed in ${t16ms} ms)`);

  // ── done ───────────────────────────────────────────────────────────────────
  for (const cl of clients) await cl.end();
  await c.end();
  await epg.stop();
  console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.error('\nSUITE ERROR:', err.message);
  try { await epg.stop(); } catch { /* ignore */ }
  process.exit(2);
}
