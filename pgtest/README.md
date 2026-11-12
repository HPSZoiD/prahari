# Schema verification suite (optional)

Runs `../supabase/schema.sql` against a real embedded Postgres 18 and verifies
grouping under 70-way concurrency, dedupe, cancel rules, RLS matrix, the
ack-bump path, and the V1.1 area rules (Unspecified bucket, manual
`location_source`, hostel/room snapshot-never-grouping) — **81 checks total**.

    npm install
    npm test

No Supabase project needed; Supabase-specific bits (roles, auth.uid) are
shimmed. See `../VERIFICATION.md` and the delivery README §4 for what each
test proves. Sections T10–T12 are the V1 concurrency gauntlet; T13–T17 are
the V1.1 additions (including the mixed 70-way burst with both spec SQL
invariant checks).
