# Project Prahari — V1.1 Verification Report

Date: 2026-11-12 · Build: V1.1 (schema + app changes over V1)
Environment: embedded Postgres 18 (pgtest suite), Vite demo mode (in-browser
mock backend mirroring `schema.sql` semantics) for UI flows, `npm run build`
production bundle.

---

## A. Requirement changes — implemented

| # | Requirement | Status |
|---|---|---|
| A1 | `incidents.area` stays a discrete string; `one_open_incident` partial unique index **unchanged**; no raw lat/lng grouping; no zones table | ✅ verified in schema + T10/T11/T16 |
| A2 | Onboarding collects **hostel + room**; snapshotted into `sos_events` at report time; profile edits never rewrite old reports (snapshot, not FK); never used to resolve `incidents.area`; Command shows it as “Registered residence (unverified)” | ✅ T15 + browser check |
| A3 | Optional location selector before SOS, searchable dropdown from shared `AREAS`; no free text (datalist offers only the 8 configured areas); selected → `area = value`, `location_source = 'manual'` | ✅ browser flow (Library) |
| A4 | Not selected → `area = 'Unspecified'`, `location_source = 'unspecified'`; reserved bucket, not in the dropdown; **no fallback to hostel or GPS** | ✅ T13/T15 + browser flow |
| A5 | Live location still captured: cached-first, never blocks SOS, refined after send via `update_sos_location`; `lat/lng/accuracy_m/location_status` stored; GPS is a Maps pin/evidence only, never the grouping key | ✅ T8 (refine never rewrites area/source) + browser (geo set, incident grouped by area not coordinates) |
| A6 | Selector UX: optional, inline, never blocks hold-to-SOS; auto-clears after 10 min and on page reload (memory-only state); Active screen shows “Reporting from: \<area\>” / “Location not set” | ✅ reload test + ActiveSOS renders both states |
| A7 | Command card: `location_source` badge (“🗺 Area selected” / “❓ Area not selected”); Unspecified incidents show “Location not specified — verify with reporters”; reporter list shows residence hint + Maps link when coords exist | ✅ browser screenshots |
| A8 | `raise_sos` accepts `p_hostel`/`p_room`; treats incoming area as manual selection; NULL/'' → Unspecified; return shape `{incident_id, event_id, report_count, status}` preserved (+ `area`, `location_source`); new columns `hostel`, `room`, `location_source`; dedupe, cancel, reset, simulate preserved | ✅ T17 + all V1 tests still green |
| A9 | Simulate Burst: spreads across selected AREAS **plus Unspecified reports**, all three types (round-robin), mixed coords, residence hints | ✅ browser burst run |

Non-goals respected: no zones, no student auth, no telecom, no escalation,
no chatbot, no embedded maps. Hostel and GPS are never grouping fallbacks
(verified by T15: same hostel + different areas → separate incidents;
same hostel + no area → same Unspecified group, never hostel-named).

---

## B. Verification results

### B1 Concurrency (70 raise_sos, mixed) — **PASS**

Suite section T16, real embedded Postgres 18, 70 concurrent client
connections, unique sessions, all three types, 6 selected areas + 3
Unspecified buckets, ~half silent, 2/3 with coordinates:

- ✅ zero errors (70/70 succeeded)
- ✅ **exact spec SQL check 1 returns 0 rows**:
  `select type, area, count(*) from incidents where status in ('active','acknowledged') group by 1,2 having count(*) > 1`
- ✅ **exact spec SQL check 2 returns 0 rows**:
  `select session_id, count(*) from sos_events where status = 'active' group by 1 having count(*) > 1`
- ✅ exactly 9 open incidents (one per pair), `report_count` matches arrivals
  per pair, total = 70, and `report_count == active events` per incident
- ✅ every Unspecified event tagged `location_source='unspecified'`; every
  named-area event tagged `'manual'`; hostel snapshotted on all 70
- Burst wall time 76 ms (same-pair T10: 253 ms; 6-pair T11: 55 ms)

Full suite: **81/81 checks passed** (12 V1 sections preserved + 5 new V1.1
sections). Run: `cd prahari/pgtest && npm install && npm test`.

### B2 Duplicate press — **PASS**

T2: same session re-triggers → returns the existing `event_id`,
`deduped: true`, count not inflated (2 stays 2).

### B3 RLS — **PASS**

T9 matrix: anon key reads `incidents` ✅, reads **0 rows** from
`sos_events` and `incident_log` (SELECT denied) ✅, INSERT denied ✅,
`reset_drill` denied ✅; authenticated (Command) reads events/log ✅,
ack/resolve UPDATE ✅, `reset_drill` ✅.

### B4 Location — **PASS**

- SOS fires immediately with cached or no coords (browser: fired with
  location permission denied — sent instantly, area stayed Unspecified).
- Refine path: T8 — owner update ok, non-owner rejected, `precise` at
  ≤50 m, `location_updated` audit row written, and crucially **area and
  location_source are NOT touched by the refine** (grouping immutable).
- Geolocation-denied flow verified in browser: “Location permission off —
  SOS still works (area + residence are sent)”.

### B5 Selector — **PASS**

- Selected area groups correctly (browser: Library + Fire → one incident,
  “🗺 Area selected” badge, no warning).
- Unspecified buckets correctly (browser: no-area send → Unspecified
  incident, “❓ Area not selected” + amber verify-with-reporters warning).
- Auto-clear: selection is React state (memory only) — page reload clears
  it (verified: after reload the field was empty); 10-minute timer clears
  it in-session (`AREA_TTL_MS = 10 * 60 * 1000`).
- Hold button never blocked by the selector: armed as soon as a TYPE is
  picked; the area input is not in the `disabled` condition.

### B6 Realtime — **PASS**

- Exactly one channel per student (`student-sos-<incident_id>` in
  ActiveSOS; Dashboard mounts no channel).
- Command: single `command-board` channel; on `SUBSCRIBED` (initial and
  every reconnect) it refetches all incidents + events — reconnect
  self-heal preserved; ConnPill states observed (● Live).
- Demo mode emulates this via BroadcastChannel — student tab updated to
  ACKNOWLEDGED and RESOLVED live during the e2e run.

### B7 Loop — **PASS** (browser e2e, demo mode)

1. Student fires (no area) → board panel lights up within ~1 s, card shows
   Unspecified + warning.
2. Command Acknowledge → student phone flips to “HELP ACKNOWLEDGED” live
   (BroadcastChannel), timeline shows the ack time.
3. Resolve → student sees “RESOLVED”, auto-returns to dashboard.
4. Cancel pre-ack: available on the student screen (cancel zone present
   while ACTIVE; V1 T6/T7 prove decrement + post-ack block in SQL).
5. Reset Drill (hold-to-confirm) → toast “all tables truncated”, board
   0 ACTIVE / 0 ACKED, student tab gracefully returns to dashboard.

### B8 Deploy — **PASS (build) / PENDING (live phone test)**

- `npm run build` passes: 170 modules, **69.5 KB gzip** JS + 5.5 KB CSS,
  `public/_redirects` SPA rule copied to `dist/`.
- `netlify.toml` unchanged (build command, publish `dist`, empty functions
  dir). Env vars needed: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (never `VITE_PRDH_DEMO` in production).
- ⚠️ Real-phone-over-HTTPS test requires your Netlify deploy — cannot be
  executed from this sandbox. Checklist: open the Netlify URL on a phone,
  allow location once (send with coords) and deny once (send without), and
  confirm the board shows the ±m chip / “no fix” respectively.

### B9 This report — **PASS** (you are reading it)

---

## Fixes made during this pass

1. **Siren could not be pressed / did not sound** (user report): the V1
   siren loaded `public/siren.mp3` into an `<audio>` element; the Test
   button was `disabled` until after Go On Duty, and `unlockAudio()`
   awaited `play()` which can reject/hang under autoplay policy or a
   stalled file load — leaving the siren dead with no feedback.
   **Fix:** rewrote `src/command/Siren.js` as a pure Web Audio
   oscillator siren (650/950 Hz square-wave yelp, 400 ms alternation,
   10 ms de-click fades). No file to load, nothing to disable: Test is
   always pressable (the click itself is the unlock gesture), GO ON DUTY
   resumes the AudioContext, and Off Duty stops the loop immediately.
   The mp3 was removed from `public/`.
2. **Schema fresh-install bug found by the suite**: the V1→V1.1 defensive
   `REVOKE ... raise_sos(uuid,…,boolean)` errored on fresh installs
   because the old 10-arg function does not exist there. Wrapped in a
   DO block with an existence check (pgtest caught it; 81/81 after fix).
3. **Silent mode**: removed from the student UI entirely — sends are
   always silent on the phone (`p_silent: true`, DB default now `true`).
4. **Onboarding**: “usual area” replaced by hostel + optional room
   (dropdown of Hostel 1/2 + Day Scholar, room validated to letters/
   digits/-/); V1 profiles auto-migrate (one-time re-onboard prompt
   because `hostel` is missing) — old reports are untouched snapshots.
5. **`raise_sos` return**: kept `{incident_id, event_id, report_count,
   status}` and added `area` + `location_source` so the student Active
   screen can display exactly what was sent without guessing.

## Notes / assumptions

- “Searchable dropdown” implemented with `<input list>` + `<datalist>`:
    native filtering, mobile-friendly, and structurally limited to the 8
    configured areas (no free-text area can ever reach the DB — the
    client only sends a value if it matches `AREAS`, else null).
- Day Scholar was added as a hostel option so non-residents have a
    truthful residence hint; it is never a grouping key.
- The 10-minute auto-clear is per-selection-change (any new pick restarts
    the timer), in-memory only — a page reload always starts Unspecified.
