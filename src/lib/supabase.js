// Supabase client gateway.
//
// Production: real client from VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// (anon key is public-safe; RLS + SECURITY DEFINER RPCs do the gating).
//
// Demo mode (VITE_PRDH_DEMO=1): an in-browser mock backend so the whole app
// can be rehearsed with zero setup. NEVER set this on Netlify — the mock is
// for local rehearsal only and is dynamically imported (never bundled into
// production builds).

import { createClient } from '@supabase/supabase-js';

const DEMO = import.meta.env.VITE_PRDH_DEMO === '1';
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isDemo = DEMO;
export const isConfigured = DEMO || Boolean(URL_ && KEY);

export let supabase = null;

export async function initSupabase() {
  if (DEMO) {
    const { createMockClient } = await import('./mock-supabase.js');
    supabase = createMockClient();
  } else if (URL_ && KEY) {
    supabase = createClient(URL_, KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
}
