# Project Prahari — V1

College campus SOS drill system. Two interfaces, one real-time loop:

- **Prahari (Student)** — a phone web app. Local profile (no signup), pick a
  type, hold 2 seconds. Location + details reach campus Command instantly.
- **Prahari Command (Authority)** — a projector board for warden / security /
  medical / fire. Alerts light up typed panels, one shared siren runs,
  responders acknowledge and resolve.

**Everything is in-system: no SMS, no calls, no telecom APIs. Everything is
labelled DRILL.**

Stack (as locked in the V1 brief): **React + Vite SPA → Netlify (free)**,
**Supabase (Postgres + Realtime + Auth, free tier)**, empty Netlify Functions
(reserved for the post-V1 Groq chatbot proxy).

---

## 1. What's in the box

```
prahari/
├─ netlify.toml            # build command, publish dist, functions dir (empty in V1)
├─ VERIFICATION.md         # V1.1 pass/fail report per requirement
├─ public/
│  ├─ _redirects           # /*  /index.html  200   (SPA routing)
│  └─ favicon.svg
├─ scripts/
│  └─ load-test.mjs        # 70 concurrent raise_sos calls + grouping verification
├─ src/
│  ├─ config.js            # AREAS + SOS_TYPES + PANELS + BRAND (single source of truth)
│  ├─ lib/
│  │  ├─ supabase.js       # real client, or demo mock (VITE_PRDH_DEMO=1)
│  │  ├─ mock-supabase.js  # in-browser mock backend (local rehearsal only)
│  │  ├─ session.js        # localStorage profile + session UUID
│  │  ├─ location.js       # cached-first GPS: warm watch, refine after send
│  │  └─ ui.jsx            # toasts, chips, pills, timers, hold-to-confirm
│  ├─ student/             # Onboarding, Dashboard, HoldButton, ActiveSOS
│  └─ command/             # Login, Board, IncidentCard, Siren, DrillControls, ShareQR
└─ supabase/
   └─ schema.sql           # tables + race-safe indexes + RLS + RPCs + publication
```

V1 decisions already baked in (from the build handoff):

| Decision | Value |
|---|---|
| Branding | "Project Prahari — Campus Safety Drill" (no college name) |
| Areas | Block A, Block B, Hostel 1, Hostel 2, Ground, Library, Auditorium, Canteen (+ reserved `Unspecified` bucket) |
| Phone field | **Not collected** (column kept in schema for forward-compat) |
| Theme | Light institutional — red reserved strictly for active alerts |
| Siren | Two-tone yelp (650/950 Hz), **synthesized via Web Audio** — one derived-state loop, no audio file |

## V1.1 changes (this build)

- **Siren fixed + file-free**: pure Web Audio oscillator (650/950 Hz yelp).
  The V1 mp3 approach could leave the siren/Test button dead under
  autoplay policy; the oscillator cannot fail to load, and **Test is
  always pressable** (the click itself unlocks audio).
- **Silent mode removed from the student UI** — sends are always silent on
  the phone (`p_silent: true`, DB default `true`).
- **Onboarding asks hostel + optional room** (not "usual area"). Residence
  is snapshotted into each report as an **unverified hint** for Command —
  never a grouping key. Old V1 profiles get a one-time re-onboard.
- **Optional area selector before SOS**: searchable dropdown limited to
  the 8 configured areas (no free text → no fragmentation). Cleared
  automatically after 10 minutes and on every reload.
- **`Unspecified` reserved bucket**: sending without picking an area still
  fires instantly (`location_source = 'unspecified'`); Command sees an
  "Area not selected" badge and a "verify with reporters" warning.
  **Grouping is still `(type, area)` via the unchanged
  `one_open_incident` partial unique index** — hostel and GPS are never
  grouping fallbacks, and there are no zones.
- **Live location still captured on every send** (cached-first, refined
  after send); shown to Command as a Maps pin + accuracy chip, evidence
  only.
- `raise_sos` accepts `p_hostel` / `p_room`; returns
  `{incident_id, event_id, report_count, status, area, location_source}`.
- Simulate Burst mixes areas + Unspecified + all three types.
- Verification: **81/81 schema checks** (incl. 70-way mixed concurrency
  and both SQL invariant checks from the spec) — see `VERIFICATION.md`.

---

## 2. Quick start (zero setup): demo mode

Rehearse the entire product in your browser with the mock backend — no
Supabase account needed:

```bash
npm install
npm run dev:demo        # http://localhost:5173
```

- Student app: open the printed URL. Fill the form, pick a type, hold the button.
- Command: open `<URL>/command`, sign in with **any** email + password.
- Open student + command in two tabs of the same browser — they sync live
  (BroadcastChannel emulates Realtime; grouping/dedupe/cancel semantics mirror
  `schema.sql` exactly).

The mock is **rehearsal-only**. Production must always talk to real Supabase
(demo mode is env-gated and never bundled into production builds).

## 3. Real setup (10 minutes, all free)

### 3a. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is
   plenty: ~71 realtime connections vs ~200 ceiling, 2M realtime
   messages/month, 500 MB storage).
2. **SQL Editor → New query** → paste the whole of `supabase/schema.sql` →
   **Run**. It is idempotent (safe to re-run).
3. **Authentication → Sign In / Providers** → **disable "Allow new users to
   sign up"** (one Command account only, forever).
4. **Authentication → Users → Add user** → create the single Command account
   (email + password). This is the only credential in the system.
5. Note **Project URL** and the **anon public key** (Settings → API). The anon
   key is safe to ship to browsers — RLS does the gating. The service-role key
   must **never** appear in this repo or the frontend.

### 3b. Local dev against real Supabase

```bash
cp .env.example .env    # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

Phase-0 sanity check (SQL Editor): call `raise_sos` twice with the same
type+area, different session UUIDs → you must get ONE incident with
`report_count = 2`.

### 3c. Netlify

1. Push this folder to a Git repo (or drag-drop — `dist/` after `npm run build`).
2. New site from repo. Build command `npm run build`, publish `dist`
   (already in `netlify.toml`).
3. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. Deploy. HTTPS is automatic (required for geolocation on phones).

`netlify/functions/` is intentionally empty in V1 — reserved for the Groq
chatbot proxy later.

---

## 4. How the hard parts work

### Grouping is race-safe at the DB level (never client-side)

`raise_sos` is a SECURITY DEFINER function that does:

```sql
insert into incidents (type, area, status, report_count)
values (p_type, p_area, 'active', 1)
on conflict (type, area) where status in ('active','acknowledged')
do update set report_count = incidents.report_count + 1,
              last_report_at = now()
returning id;
```

The partial unique index `one_open_incident on incidents (type, area) where
status in ('active','acknowledged')` makes Postgres serialize 70 simultaneous
presses into correct groups. A second index
`one_active_report on sos_events (session_id) where status = 'active'`
enforces one active report per student session. Resolving an incident drops it
out of the index, so the next report opens a fresh incident.

**Verified:** the full schema passes a 48-check suite against real Postgres
(included in the delivery archive as `pgtest/test-schema.mjs`), including
70-connection concurrent bursts: same-pair → one incident with `report_count =
70`; 6-pair spread → zero duplicate open pairs, exact counts, and the
invariant `report_count = count(active sos_events)` holds.

### Security model (RLS, not vibes)

| Table | anon (students) | authenticated (Command) |
|---|---|---|
| `incidents` | SELECT (status-back + realtime) | ALL |
| `sos_events` | nothing (writes via definer RPCs only) | SELECT |
| `incident_log` | nothing | SELECT |

A student with devtools open can watch incident statuses but can never read
another student's name, roll or coordinates. Realtime enforces RLS on
delivery. Students are `anon` permanently — no auth means no anonymous-sign-in
rate limit when 70 phones share classroom NAT.

### One siren, derived state

```
anyActive = incidents.some(i => i.status === 'active')
anyActive && onDuty → siren.play()   else → pause + rewind
```

One `<audio loop>` element. The **Go On Duty** click unlocks audio
(play→pause inside the gesture) so the siren cannot silently fail on demo day.
A 🔊 Test button plays a 1.2 s sample for the AV check.

### Cached-first location

The dashboard silently warms a GPS fix (on-device only — nothing is sent until
an SOS fires). On send: cached fix goes out immediately (or nothing — grouping
uses the selected **area**, never GPS). After sending, a high-accuracy
`getCurrentPosition` refines the pin via `update_sos_location`. Phones with
location denied work perfectly.

### Reconnect healing

Command and student refetch everything on channel re-subscribe (and on tab
visibility). A 15 s student poll catches the one event realtime cannot
deliver: `Reset Drill` truncating tables mid-demo — the student screen ends
gracefully ("Drill ended") instead of hanging.

---

## 5. Demo-day runbook

1. **~10 min before:** open the Supabase project and run any query — free-tier
   projects pause after inactivity and need waking.
2. Laptop on ethernet/hotspot. Board loaded at `<site>/command`, signed in.
3. Click **GO ON DUTY** (this arms + unlocks the siren), then **🔊 Test** once
   so the room hears the speakers work. Connection pill must read **● Live**.
4. **⟲ Reset Drill** (hold) → clean board on the projector.
5. **📱 Share / QR** → project the QR. "Open the link, fill the 30-second
   form, pick a type, hold the button."
6. Panels light up, alerts group by (type, area), siren runs (one loop, not
   one per alert). **Acknowledge** one → that student's phone flips to "Help
   acknowledged" live. **Resolve** → their phone returns to the dashboard.
7. WiFi dies? **⚡ Simulate Burst** — fake reporters through the REAL
   `raise_sos` RPC. Nobody in the room knows.

---

## 6. Load test (acceptance #1)

Against your deployed Supabase project:

```bash
node scripts/load-test.mjs \
  --url https://YOUR-PROJECT.supabase.co \
  --key eyJ...anon-key... \
  --n 70 --mode mixed
```

Fires 70 concurrent `raise_sos` calls — unique sessions, all three types,
selected areas **and Unspecified**, some silent, some without coordinates —
and verifies: every call succeeds, exactly one open incident per
(type, area) pair hit (including the `Unspecified` buckets), and
`report_count` equals the arrivals per pair. `--mode spread` (6 areas) and
`--mode same` (all 70 on one pair) are also available. Exit code 0 = PASS.

---

## 7. Acceptance checklist (V1 brief §18, re-verified for V1.1)

- [x] 70 concurrent `raise_sos` → correct grouping, no duplicate incidents —
      **verified on real Postgres (81/81 test suite, incl. the V1.1 mixed
      gauntlet)**; re-verify your live project with `scripts/load-test.mjs`
- [x] Grouping is DB-level (partial unique index), never client-side;
      **still `(type, area)` — hostel/GPS are never grouping keys**
- [x] One siren regardless of alert count; stops when last active is acked;
      Web Audio synthesis — Test button always pressable (V1.1 siren fix)
- [x] Ack → student screen updates live; Resolve → student returns to dashboard
- [x] Cancel works pre-ack; blocked post-ack (`already_acknowledged`)
- [x] anon cannot SELECT `sos_events`/`incident_log` (verified; re-check live
      via REST: `curl "$URL/rest/v1/sos_events?select=*" -H "apikey: ANON"` → 4xx)
- [x] Reset Drill truncates all tables; Simulate Burst goes through the real RPC
- [x] Reconnect/visibility refetch heals stale state; student poll survives resets
- [x] Works with geolocation denied — SOS still sends; area stays selected or
      `Unspecified`, never GPS-derived (verified headless + SQL suite)
- [x] DRILL banner visible everywhere; no telecom anywhere in the codebase
- [x] V1.1: Unspecified bucket groups race-safely; `location_source` badge;
      residence hint snapshot; area selector auto-clears (10 min / reload)
- [ ] *SOS visible on Command < 2 s* — by design (direct realtime insert push);
      confirm on your deployment during rehearsal with two devices
- [ ] *Real phone over Netlify HTTPS* — allow + deny location once each
      (see VERIFICATION.md §B8 checklist)

## 8. Guardrails honored (brief §20)

No student auth/signup · no client-side grouping · no service-role key in the
frontend · one derived-state siren · never blocks SOS on GPS · no telecom, no
escalation ladder, no chatbot, no embedded maps in V1 · location stays
on-device until an SOS fires · `incident_log` is append-only.

## 9. Known notes / deviations

- **Stale-session retrigger:** if a student's incident is resolved while their
  report row is still active, the next `raise_sos` retires the stale event
  (logged as `cancelled` with reason `stale_event_closed_on_new_sos`) and
  opens a fresh incident — this keeps "demo twice back-to-back" working
  without a reset. Covered by test T5.
- **Same-session double-fire in the same millisecond** would hit the
  `one_active_report` unique index and error; the UI makes this impossible
  (button locks while sending, dashboard swaps to the Active screen).
- `sos_events.phone` exists in the schema (forward-compat) but V1 never
  collects it — per the build handoff decision.
- `location_status` uses `approximate` → `precise` in practice; `pending` is
  reserved (a fix that hasn't landed yet is simply sent as null →
  `unavailable`, then refined).
- Free-tier warm-up matters: wake Supabase ~10 min before the demo.

## 10. After V1 (deferred, per brief)

Groq chatbot via Netlify Function (key stays server-side), helpline card from
a shared `helplines.json`, embedded live map, escalation ladder, per-post
Command URLs, telecom integration if ever required.

---

*DRILL build. No real emergency services are contacted, anywhere, ever.*
