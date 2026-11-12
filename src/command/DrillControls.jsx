import { useState } from 'react';
import { AREAS, SOS_TYPES, CAMPUS_CENTER } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { HoldAction } from '../lib/ui.jsx';

// Simulate Burst: injects fake reports through the REAL raise_sos RPC
// (the same path a phone takes). WiFi-failure fallback + rehearsal tool.
// V1.1: mixes manual areas (~75%) with no-area reports (→ 'Unspecified'
// bucket), all three types, with/without coords, and residence hints.
// Reset Drill: hold-to-confirm, command-only RPC that truncates all tables.

const NAMES = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Arjun', 'Divya',
  'Karan', 'Meera', 'Aditya', 'Pooja', 'Rahul', 'Neha', 'Siddharth', 'Isha',
  'Manav', 'Tara', 'Dev', 'Kavya', 'Nikhil', 'Riya', 'Sameer', 'Anjali',
];
const HOSTELS = ['Hostel 1', 'Hostel 2', 'Hostel 1', 'Hostel 2', 'Day Scholar'];

export default function DrillControls({ onAfterReset, busy, push, inMenu = false, onMenuAction }) {
  const [burstOpen, setBurstOpen] = useState(false);
  const [burstCount, setBurstCount] = useState(12);
  const [burstProgress, setBurstProgress] = useState(null); // {done,total}
  const [resetBusy, setResetBusy] = useState(false);

  const runBurst = async () => {
    if (burstProgress) return;
    setBurstProgress({ done: 0, total: burstCount });
    let done = 0;
    for (let i = 0; i < burstCount; i++) {
      const delay = 120 + Math.random() * 260;
      await new Promise((r) => setTimeout(r, delay));
      const name = NAMES[Math.floor(Math.random() * NAMES.length)] + ' ' + String.fromCharCode(65 + (i % 26)) + '.';
      const type = SOS_TYPES[i % SOS_TYPES.length].id;          // all three types, round-robin
      const withArea = Math.random() > 0.25;                    // ~25% send without an area
      const area = withArea ? AREAS[Math.floor(Math.random() * AREAS.length)] : null;
      const withFix = Math.random() > 0.25;                     // ~25% have no GPS fix
      const jitter = () => (Math.random() - 0.5) * 0.003;
      const hostel = HOSTELS[Math.floor(Math.random() * HOSTELS.length)];
      const session = (crypto.randomUUID ? crypto.randomUUID() : 'burst-' + Math.random());
      try {
        await supabase.rpc('raise_sos', {
          p_session: session,
          p_name: name,
          p_roll: `CS2K23-${100 + i}`,
          p_phone: null,
          p_area: area,                                        // null → 'Unspecified' bucket
          p_type: type,
          p_lat: withFix ? CAMPUS_CENTER.lat + jitter() : null,
          p_lng: withFix ? CAMPUS_CENTER.lng + jitter() : null,
          p_acc: withFix ? Math.round(8 + Math.random() * 40) : null,
          p_silent: true,                                      // V1.1: always silent
          p_hostel: hostel,
          p_room: hostel === 'Day Scholar' ? null : `${String.fromCharCode(65 + (i % 4))}-${100 + (i % 90)}`,
        });
      } catch { /* individual failure is fine — the board still shows the rest */ }
      done++;
      setBurstProgress({ done, total: burstCount });
    }
    setBurstProgress(null);
    setBurstOpen(false);
    push && push(`Burst complete — ${burstCount} simulated reports sent through the real RPC.`, 'success');
  };

  const runReset = async () => {
    if (resetBusy) return;
    setResetBusy(true);
    const { error } = await supabase.rpc('reset_drill');
    setResetBusy(false);
    if (error) {
      push && push(`Reset failed: ${error.message}`, 'error');
      return;
    }
    onAfterReset && onAfterReset();
    push && push('Drill reset — all tables truncated. Clean board.', 'success');
  };

  const btnCls = inMenu ? 'menu-item' : 'btn btn-outline btn-sm';

  return (
    <>
      <button
        className={btnCls}
        onClick={() => { onMenuAction?.(); setBurstOpen(true); }}
        disabled={busy || Boolean(burstProgress)}
      >
        Simulate burst
      </button>
      <HoldAction
        label="Reset drill (hold)"
        className={inMenu ? 'menu-item hold-menu' : 'btn-sm'}
        disabled={busy || resetBusy}
        onConfirm={runReset}
      />

      {burstOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBurstOpen(false); }}>
          <div className="modal" role="dialog" aria-label="Simulate burst">
            <h3>Simulate burst</h3>
            <p className="muted small">
              Injects fake student reports through the <strong>real</strong>{' '}
              <code>raise_sos</code> RPC — exactly the path a phone takes.
              All three types; ~75% with a picked area, the rest land in the
              reserved <strong>Unspecified</strong> bucket; ~75% with GPS
              coordinates and residence hints. Use it as the WiFi-failure
              fallback on demo day.
            </p>
            <div className="burst-count-row">
              <span className="small">Reports</span>
              <input
                type="range" min="4" max="20" value={burstCount}
                onChange={(e) => setBurstCount(Number(e.target.value))}
                aria-label="Number of simulated reports"
              />
              <span className="bc-val">{burstCount}</span>
            </div>
            {burstProgress ? (
              <div className="burst-progress">
                <span className="spinner" /> Bursting {burstProgress.done}/{burstProgress.total}…
              </div>
            ) : (
              <div className="modal-actions">
                <button className="btn btn-outline" onClick={() => setBurstOpen(false)}>Cancel</button>
                <button className="btn" onClick={runBurst}>Start burst</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
