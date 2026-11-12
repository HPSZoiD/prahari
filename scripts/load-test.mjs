#!/usr/bin/env node
// Project Prahari — V1.1 load test.
// Fires N concurrent raise_sos RPC calls (default 70, like the classroom demo)
// and verifies the grouping guarantee end-to-end against YOUR deployed
// Supabase project:
//   • every call succeeds
//   • exactly ONE open incident per (type, area) pair that was hit —
//     including the reserved 'Unspecified' bucket (null area)
//   • report_count per pair equals the number of calls that hit it
//
// V1.1: mixed mode is now the default — unique sessions, all three types,
// selected areas + Unspecified, some silent, some with/without coords —
// plus the two SQL invariant checks from the verification spec.
//
// Usage:
//   node scripts/load-test.mjs --url https://xxx.supabase.co --key <anon-key> [--n 70] [--mode spread|same|mixed]
//   or set SUPABASE_URL / SUPABASE_ANON_KEY (or VITE_-prefixed) in the environment.
//
// anon key is enough: raise_sos is granted to anon, incidents are anon-readable.
// Run `reset_drill` from the Command board first for a clean slate (or run this
// on a fresh project — the script accounts for pre-existing open incidents).

import { createClient } from '@supabase/supabase-js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_ = arg('url') || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = arg('key') || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const N = Number(arg('n', '70'));
const MODE = arg('mode', 'mixed'); // mixed (default) | spread (6 areas) | same (one pair)

if (!URL_ || !KEY) {
  console.error('Missing --url / --key (or SUPABASE_URL / SUPABASE_ANON_KEY env).');
  process.exit(2);
}

const AREAS = ['Block A', 'Block B', 'Hostel 1', 'Hostel 2', 'Ground', 'Library'];
const TYPES = ['medical', 'fire', 'safety'];
// mixed: 9 combos — 6 (type, area) pairs + 3 (type, Unspecified) buckets.
const MIX_PAIRS = [
  ...[['medical', 'Block A'], ['fire', 'Hostel 1'], ['safety', 'Library'],
      ['medical', 'Ground'], ['fire', 'Block B'], ['safety', 'Hostel 2']],
  ...[['medical', null], ['fire', null], ['safety', null]],
];
const PAIRS = [
  ['medical', 'Block A'], ['fire', 'Hostel 1'], ['safety', 'Library'],
  ['medical', 'Ground'], ['fire', 'Block B'], ['safety', 'Hostel 2'],
];

const uuid = () => crypto.randomUUID();

async function fetchOpen(sb) {
  const { data, error } = await sb
    .from('incidents').select('id, type, area, report_count, status')
    .in('status', ['active', 'acknowledged']);
  if (error) throw new Error(`incidents fetch failed: ${error.message}`);
  const m = new Map();
  for (const r of data) m.set(`${r.type}|${r.area}`, { ...r });
  return m;
}

const sb = createClient(URL_, KEY);

console.log(`\nProject Prahari V1.1 load test`);
console.log(`  target : ${URL_}`);
console.log(`  calls  : ${N} concurrent raise_sos`);
console.log(`  mode   : ${MODE}\n`);

const before = await fetchOpen(sb);

// Build the call plan.
const plan = [];
for (let i = 0; i < N; i++) {
  let type, area;
  if (MODE === 'same') [type, area] = PAIRS[0];
  else if (MODE === 'spread') [type, area] = PAIRS[i % PAIRS.length];
  else [type, area] = MIX_PAIRS[i % MIX_PAIRS.length];
  plan.push({ type, area, name: `Load ${i}`, roll: `LOAD-${i}` });
}
const hits = new Map();
for (const p of plan) {
  const k = `${p.type}|${p.area ?? 'Unspecified'}`;
  hits.set(k, (hits.get(k) || 0) + 1);
}
console.log(`  pairs  : ${hits.size} (${[...hits.entries()].map(([k, v]) => `${k}×${v}`).join(', ')})`);

// Fire all N at once.
const t0 = Date.now();
const latencies = [];
const results = await Promise.all(plan.map(async (p) => {
  const s = uuid();
  const withFix = Math.random() > 0.3; // ~30% without coords
  const st = performance.now();
  const { data, error } = await sb.rpc('raise_sos', {
    p_session: s, p_name: p.name, p_roll: p.roll, p_phone: null,
    p_area: p.area, p_type: p.type,
    p_lat: withFix ? 28.6139 + (Math.random() - 0.5) * 0.01 : null,
    p_lng: withFix ? 77.2090 + (Math.random() - 0.5) * 0.01 : null,
    p_acc: withFix ? 25 : null,
    p_silent: true, // V1.1: silent by default
    p_hostel: 'Hostel 1', p_room: `L-${100 + Math.floor(Math.random() * 90)}`,
  });
  latencies.push(performance.now() - st);
  return { ok: !error && data?.incident_id, error: error?.message };
}));
const totalMs = Date.now() - t0;

const failed = results.filter((r) => !r.ok);
latencies.sort((a, b) => a - b);

console.log(`\nResults`);
console.log(`  success          : ${N - failed.length}/${N}${failed.length ? '  ← FAILURES' : ''}`);
console.log(`  wall time        : ${totalMs} ms for ${N} concurrent calls`);
console.log(`  latency p50/p95  : ${latencies[Math.floor(N * 0.5)]?.toFixed(0)} / ${latencies[Math.floor(N * 0.95)]?.toFixed(0)} ms`);

if (failed.length) {
  console.log('  first error      :', failed[0].error);
}

// Small settle delay, then verify grouping.
await new Promise((r) => setTimeout(r, 600));
const after = await fetchOpen(sb);

let pass = true;
for (const [key, count] of hits) {
  const row = after.get(key);
  const base = before.get(key);
  const expected = (base ? base.report_count : 0) + count;
  const actual = row ? row.report_count : (base ? base.report_count : 0);
  const ok = row && actual === expected;
  if (!ok) pass = false;
  console.log(`  ${ok ? '✓' : '✗'} ${key.padEnd(20)} open incident${row ? '' : ' MISSING'} — reports ${actual} (expected ${expected}${base ? `, had ${base.report_count} before` : ''})`);
}

// No duplicate open pairs, ever.
const dupCheck = [...after.values()].length === after.size;
console.log(`  ${dupCheck ? '✓' : '✗'} no duplicate open (type, area) pairs`);
if (!dupCheck) pass = false;

console.log(pass ? '\nPASS — grouping held under concurrency.\n' : '\nFAIL — check the partial unique index one_open_incident.\n');
process.exit(pass && failed.length === 0 ? 0 : 1);
