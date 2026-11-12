-- ============================================================================
-- PROJECT PRAHARI — V1.1 SCHEMA (Supabase / Postgres)
-- ----------------------------------------------------------------------------
-- Run this ENTIRE file in the Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → paste → Run.
-- It is idempotent: safe to re-run (also over a V1 install).
--
-- V1.1 changes over V1:
--   • sos_events gains hostel, room, location_source
--   • raise_sos accepts p_hostel/p_room; a NULL/empty p_area now lands in
--     the reserved 'Unspecified' bucket instead of erroring
--   • location_source: 'manual' (student picked an area) | 'unspecified'
--   • Grouping is STILL (type, area) via the one_open_incident partial
--     unique index — untouched. No zones, no GPS grouping.
--
-- After running, do these two steps in the Dashboard (they cannot be done
-- from SQL on hosted Supabase):
--   1. Authentication → Sign Up / Providers → DISABLE "Allow new users to
--      sign up".  (One Command account only — signups stay off forever.)
--   2. Authentication → Users → Add user → create the single Command account
--      (email + password). Share the credentials securely with the operator.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────────────────────────────────────
-- 'Unspecified' is a RESERVED area bucket (see raise_sos): reports sent
-- without an area selection land there. It is never offered in the student
-- dropdown and never derived from hostel or GPS.

create table if not exists public.incidents (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in ('medical','fire','safety')),
  area            text not null,          -- discrete string; 'Unspecified' is reserved
  status          text not null default 'active'
                    check (status in ('active','acknowledged','resolved','cancelled')),
  report_count    integer not null default 1,
  created_at      timestamptz not null default now(),
  last_report_at  timestamptz not null default now(),
  ack_at          timestamptz,
  ack_by          text,
  resolved_at     timestamptz,
  resolution_note text
);

create table if not exists public.sos_events (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references public.incidents(id),
  session_id      uuid not null,
  name            text,
  roll            text,
  phone           text,          -- not collected by the V1 UI; kept for forward-compat
  hostel          text,          -- registered residence, snapshotted at report time (hint only)
  room            text,          -- never used to resolve incidents.area
  area            text not null, -- grouping key as sent: manual selection or 'Unspecified'
  type            text not null check (type in ('medical','fire','safety')),
  lat             float8,
  lng             float8,
  accuracy_m      float8,
  location_status text check (location_status in ('pending','approximate','precise','unavailable')),
  location_source text not null default 'unspecified'
                    check (location_source in ('manual','unspecified')),
  silent          boolean not null default true,   -- V1.1: silent by default, no UI toggle
  status          text not null default 'active' check (status in ('active','cancelled')),
  created_at      timestamptz not null default now()
);

-- ── V1 → V1.1 migration (no-ops on a fresh install) ──────────────────────────
alter table public.sos_events add column if not exists hostel text;
alter table public.sos_events add column if not exists room   text;
alter table public.sos_events add column if not exists location_source text
  not null default 'unspecified';
-- Enforce the CHECK on location_source even when the column pre-exists V1.1.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sos_events_location_source_check') then
    alter table public.sos_events
      add constraint sos_events_location_source_check
      check (location_source in ('manual','unspecified'));
  end if;
end $$;

-- Append-only audit trail. Nothing in V1 ever UPDATEs or DELETEs this table.
create table if not exists public.incident_log (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  event       text,   -- created | report_added | acknowledged | resolved | cancelled | location_updated
  actor       text,   -- 'student:<session-uuid>' | 'command'
  meta        jsonb,
  ts          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CRITICAL INDEXES — the concurrency guarantee
-- ─────────────────────────────────────────────────────────────────────────────

-- ONE open incident per (type, area). Makes find-or-create in raise_sos
-- race-safe: 70 simultaneous presses serialize into correct groups at the
-- DB level. Resolved/cancelled incidents are outside the index, so the next
-- report after a resolve creates a fresh incident.
create unique index if not exists one_open_incident
  on public.incidents (type, area)
  where status in ('active','acknowledged');

-- ONE active report per student session (dedupe; enforced by the partial
-- unique index and honoured by raise_sos).
create unique index if not exists one_active_report
  on public.sos_events (session_id)
  where status = 'active';

-- Query support for the Command board.
create index if not exists sos_events_incident_idx   on public.sos_events (incident_id);
create index if not exists sos_events_session_idx    on public.sos_events (session_id);
create index if not exists incident_log_incident_idx on public.incident_log (incident_id, ts);
create index if not exists incidents_status_idx      on public.incidents (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
--    anon            = every student phone (no auth, anon key only)
--    authenticated   = the ONE pre-provisioned Command account
--    Students write ONLY through the SECURITY DEFINER RPCs below; they can
--    never read anyone's name, roll or coordinates from sos_events.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.incidents    enable row level security;
alter table public.sos_events   enable row level security;
alter table public.incident_log enable row level security;

-- incidents: anon may READ (student status-back + realtime), Command has all.
drop policy if exists "incidents: anon can read" on public.incidents;
create policy "incidents: anon can read"
  on public.incidents for select
  to anon
  using (true);

drop policy if exists "incidents: command full access" on public.incidents;
create policy "incidents: command full access"
  on public.incidents for all
  to authenticated
  using (true) with check (true);

-- sos_events: anon gets NOTHING (writes happen via SECURITY DEFINER RPCs,
-- which bypass RLS as the function owner). Command may read for reporter lists.
drop policy if exists "sos_events: command can read" on public.sos_events;
create policy "sos_events: command can read"
  on public.sos_events for select
  to authenticated
  using (true);

-- incident_log: Command read-only.
drop policy if exists "incident_log: command can read" on public.incident_log;
create policy "incident_log: command can read"
  on public.incident_log for select
  to authenticated
  using (true);

-- Table-level privileges (belt-and-braces on top of RLS).
grant usage on schema public to anon, authenticated;

revoke all on public.sos_events   from anon;
revoke all on public.incident_log from anon, authenticated;
grant select on public.sos_events   to authenticated;
grant select on public.incident_log to authenticated;

grant select on public.incidents to anon;
grant select, insert, update, delete on public.incidents to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC SURFACE
--    Students (anon) may call ONLY these three SECURITY DEFINER functions.
--    All return jsonb so the client gets a plain object, e.g.
--      raise_sos → {"incident_id": "...", "event_id": "...",
--                   "report_count": 3, "status": "active"}
-- ─────────────────────────────────────────────────────────────────────────────

-- raise_sos ------------------------------------------------------------------
-- Dedupe check → find-or-create incident → insert event → log.
-- V1.1: p_area may be NULL/empty → 'Unspecified' reserved bucket with
-- location_source='unspecified'; a real selection → location_source='manual'.
-- Hostel/room are snapshotted as a residence hint — NEVER used for grouping.
create or replace function public.raise_sos(
  p_session uuid,
  p_name    text,
  p_roll    text,
  p_phone   text,     -- kept for signature compatibility; V1 UI sends null
  p_area    text,     -- manual area selection, or NULL/'' → 'Unspecified'
  p_type    text,
  p_lat     float8,
  p_lng     float8,
  p_acc     float8,
  p_silent  boolean default true,
  p_hostel  text default null,
  p_room    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id   uuid;
  v_event_id      uuid;
  v_report_count  integer;
  v_status        text;
  v_prev_event_id uuid;
  v_prev_incident uuid;
  v_prev_status   text;
  v_area          text;
  v_source        text;
begin
  -- Validation (type is strict; area resolves to a discrete string).
  if p_session is null then
    raise exception 'session id is required';
  end if;
  if p_type not in ('medical','fire','safety') then
    raise exception 'invalid SOS type: %', p_type;
  end if;

  -- ── Area resolution (A3/A4): manual selection or the reserved bucket.
  -- Never fall back to hostel, room or GPS coordinates.
  if p_area is null or btrim(p_area) = '' then
    v_area   := 'Unspecified';
    v_source := 'unspecified';
  else
    v_area   := btrim(p_area);
    v_source := 'manual';
  end if;

  -- ── Dedupe: one active SOS per session ────────────────────────────────────
  select e.id, e.incident_id, i.status
    into v_prev_event_id, v_prev_incident, v_prev_status
    from public.sos_events e
    join public.incidents i on i.id = e.incident_id
   where e.session_id = p_session
     and e.status = 'active'
   order by e.created_at desc
   limit 1;

  if v_prev_event_id is not null then
    if v_prev_status in ('active','acknowledged') then
      -- Re-trigger while their SOS is still open: return the existing report.
      select i.report_count, i.status
        into v_report_count, v_status
        from public.incidents i
       where i.id = v_prev_incident;
      return jsonb_build_object(
        'incident_id',   v_prev_incident,
        'event_id',      v_prev_event_id,
        'report_count',  v_report_count,
        'status',        v_status,
        'deduped',       true);
    else
      -- Their previous incident was resolved/cancelled: retire the stale
      -- event (append-only log keeps the trail) and let them raise fresh.
      update public.sos_events e
         set status = 'cancelled'
       where e.id = v_prev_event_id;
      insert into public.incident_log (incident_id, event, actor, meta)
      values (v_prev_incident, 'cancelled', 'student:' || p_session::text,
              jsonb_build_object('reason', 'stale_event_closed_on_new_sos',
                                 'event_id', v_prev_event_id));
    end if;
  end if;

  -- ── Find-or-create the incident ───────────────────────────────────────────
  -- ON CONFLICT against the partial unique index `one_open_incident` lets
  -- Postgres serialize 70 simultaneous presses into correct groups —
  -- including everyone who lands in 'Unspecified'.
  insert into public.incidents as inc (type, area, status, report_count)
  values (p_type, v_area, 'active', 1)
  on conflict (type, area) where status in ('active','acknowledged')
  do update set report_count   = inc.report_count + 1,
                last_report_at = now()
  returning inc.id, inc.report_count, inc.status
  into v_incident_id, v_report_count, v_status;

  -- ── The report itself ─────────────────────────────────────────────────────
  insert into public.sos_events (incident_id, session_id, name, roll, phone,
                                 hostel, room, area, type, lat, lng, accuracy_m,
                                 location_status, location_source, silent)
  values (v_incident_id, p_session,
          nullif(left(btrim(coalesce(p_name, '')), 80), ''),
          nullif(left(btrim(coalesce(p_roll, '')), 40), ''),
          nullif(left(btrim(coalesce(p_phone, '')), 20), ''),
          nullif(left(btrim(coalesce(p_hostel, '')), 60), ''),
          nullif(left(btrim(coalesce(p_room, '')), 40), ''),
          v_area, p_type, p_lat, p_lng, p_acc,
          case when p_lat is null or p_lng is null then 'unavailable'
               else 'approximate' end,
          v_source,
          coalesce(p_silent, true))
  returning id into v_event_id;

  -- ── Audit trail ───────────────────────────────────────────────────────────
  insert into public.incident_log (incident_id, event, actor, meta)
  values (v_incident_id,
          case when v_report_count = 1 then 'created' else 'report_added' end,
          'student:' || p_session::text,
          jsonb_build_object(
            'event_id',        v_event_id,
            'type',            p_type,
            'area',            v_area,
            'location_source', v_source,
            'silent',          coalesce(p_silent, true),
            'location_status', case when p_lat is null or p_lng is null
                                    then 'unavailable' else 'approximate' end));

  return jsonb_build_object(
    'incident_id',      v_incident_id,
    'event_id',         v_event_id,
    'report_count',     v_report_count,
    'status',           v_status,
    'area',             v_area,
    'location_source',  v_source);
end;
$$;

-- update_sos_location ---------------------------------------------------------
-- Called AFTER raise_sos once a high-accuracy fix arrives. Verifies the
-- session owns the event and the report is still active.
create or replace function public.update_sos_location(
  p_event   uuid,
  p_session uuid,
  p_lat     float8,
  p_lng     float8,
  p_acc     float8
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
  v_new_status  text;
begin
  v_new_status := case
                    when p_acc is not null and p_acc <= 50 then 'precise'
                    else 'approximate'
                  end;

  update public.sos_events e
     set lat = p_lat,
         lng = p_lng,
         accuracy_m = p_acc,
         location_status = v_new_status
   where e.id = p_event
     and e.session_id = p_session
     and e.status = 'active'
  returning e.incident_id into v_incident_id;

  if v_incident_id is null then
    return jsonb_build_object('ok', false, 'reason', 'event_not_active');
  end if;

  insert into public.incident_log (incident_id, event, actor, meta)
  values (v_incident_id, 'location_updated', 'student:' || p_session::text,
          jsonb_build_object('event_id', p_event, 'lat', p_lat, 'lng', p_lng,
                             'accuracy_m', p_acc, 'location_status', v_new_status));

  return jsonb_build_object('ok', true, 'location_status', v_new_status);
end;
$$;

-- cancel_sos ------------------------------------------------------------------
-- Student cancel, ONLY while the incident is unacknowledged. Cancels the
-- event, decrements the count, auto-cancels the incident at 0 reports.
create or replace function public.cancel_sos(
  p_event   uuid,
  p_session uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id     uuid;
  v_incident_id  uuid;
  v_status       text;
  v_new_count    integer;
begin
  if p_event is null or p_session is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_args');
  end if;

  -- The event must exist, belong to this session and still be active.
  select e.id, e.incident_id
    into v_event_id, v_incident_id
    from public.sos_events e
   where e.id = p_event
     and e.session_id = p_session
     and e.status = 'active';

  if v_event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'event_not_active');
  end if;

  -- Cancel is blocked once Command has acknowledged.
  select i.status into v_status from public.incidents i where i.id = v_incident_id;
  if v_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'reason', 'already_acknowledged',
                              'incident_status', v_status);
  end if;

  update public.sos_events e
     set status = 'cancelled'
   where e.id = v_event_id;

  -- Decrement; auto-cancel the incident when the last reporter leaves.
  update public.incidents as inc
     set report_count = greatest(inc.report_count - 1, 0)
   where inc.id = v_incident_id
  returning inc.report_count into v_new_count;

  if v_new_count <= 0 then
    update public.incidents as inc
       set status = 'cancelled'
     where inc.id = v_incident_id;
  end if;

  insert into public.incident_log (incident_id, event, actor, meta)
  values (v_incident_id, 'cancelled', 'student:' || p_session::text,
          jsonb_build_object('event_id', v_event_id, 'reports_remaining',
                             greatest(v_new_count, 0)));

  return jsonb_build_object(
    'ok', true,
    'incident_status', case when v_new_count <= 0 then 'cancelled' else 'active' end,
    'report_count',    greatest(v_new_count, 0));
end;
$$;

-- reset_drill -----------------------------------------------------------------
-- COMMAND ONLY: wipes all three tables between demo rounds.
create or replace function public.reset_drill()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'reset_drill: command only';
  end if;
  truncate public.incident_log, public.sos_events, public.incidents;
end;
$$;

-- Execute grants.
-- Student RPCs: callable with the anon key (and by Command for simulate burst).
-- NOTE: signature now includes p_hostel/p_room (V1.1).
grant execute on function public.raise_sos(uuid, text, text, text, text, text, float8, float8, float8, boolean, text, text) to anon, authenticated;
-- Defensive: drop the old 10-arg grant target if upgrading from V1.
-- (A bare REVOKE errors on a fresh install where that function never
-- existed, so gate it on existence.)
do $$ begin
  if exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'raise_sos'
               and pg_get_function_identity_arguments(p.oid) =
                   '(uuid, text, text, text, text, text, double precision, double precision, double precision, boolean)') then
    revoke execute on function public.raise_sos(uuid, text, text, text, text, text, float8, float8, float8, boolean) from anon, authenticated;
  end if;
end $$;
grant execute on function public.update_sos_location(uuid, uuid, float8, float8, float8) to anon, authenticated;
grant execute on function public.cancel_sos(uuid, uuid) to anon, authenticated;

-- reset_drill: Command only.
revoke execute on function public.reset_drill() from public, anon;
grant execute on function public.reset_drill() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REALTIME
--    Command subscribes to incidents + sos_events; students subscribe to
--    incidents (anon-readable, no PII). RLS is enforced on delivery.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'incidents') then
    alter publication supabase_realtime add table public.incidents;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'sos_events') then
    alter publication supabase_realtime add table public.sos_events;
  end if;
end $$;

-- ============================================================================
-- DONE. Remember the two Dashboard steps from the header (disable signups,
-- create the Command account), and warm the project ~10 min before the demo
-- (free-tier projects pause after inactivity — run any query to wake them).
-- V1.1 grouping rules, for the record: area = manual selection or
-- 'Unspecified'; hostel/room and GPS are display hints only, never grouping
-- keys; the one_open_incident index is unchanged from V1.
-- ============================================================================
