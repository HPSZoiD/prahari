import { useEffect, useState } from 'react';
import { BRAND } from '../config.js';
import { getProfile, getActive } from '../lib/session.js';
import { useToasts, Toasts } from '../lib/ui.jsx';
import Onboarding from './Onboarding.jsx';
import Dashboard from './Dashboard.jsx';
import ActiveSOS from './ActiveSOS.jsx';

// Student entry point. Local identity only — no signup, ever.
export default function StudentApp() {
  const [profile, setProfile] = useState(() => getProfile());
  const [active, setActive] = useState(() => getActive());
  const [editing, setEditing] = useState(false);
  const { toasts, push } = useToasts();

  // V1 → V1.1 migration: old profiles had `area` (usual area). The selector
  // is now per-SOS, so drop the stale field and ask for hostel on next edit.
  // (Profiles straight from V1.1 onboarding always have hostel/room.)
  useEffect(() => {
    if (profile && profile.hostel == null) {
      setEditing(true);
      push('One-time update: add your hostel for the new SOS form.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOnboard = (p) => {
    setProfile(p);
    setEditing(false);
    push('Profile saved on this phone. Ready when you are.');
  };

  const handleFired = (result, meta) => {
    const a = {
      incident_id: result.incident_id,
      event_id: result.event_id,
      type: meta.type,
      area: meta.area,
      location_source: meta.location_source,
      sent_at: meta.sent_at || new Date().toISOString(),
    };
    setActive(a);
  };

  const handleEnded = (status) => {
    setActive(null);
    if (status === 'resolved') push('Incident resolved — drill complete. Thank you!', 'success');
    else if (status === 'cancelled') push('SOS cancelled.');
    else push('Drill ended.');
  };

  return (
    <div className="student-app">
      <header className="student-header">
        <div className="student-brand">
          <span className="brand-icon" aria-hidden="true">🛡️</span>
          <div>
            <div className="brand-name">{BRAND.name}</div>
            <div className="brand-sub">{BRAND.tagline}</div>
          </div>
        </div>
        <span className="drill-chip">⚠ DRILL</span>
      </header>

      {!profile || editing ? (
        <Onboarding initial={profile} onDone={handleOnboard} />
      ) : active ? (
        <ActiveSOS active={active} profile={profile} onEnded={handleEnded} />
      ) : (
        <Dashboard
          profile={profile}
          onFired={handleFired}
          onEdit={() => setEditing(true)}
        />
      )}

      <div className="student-footer-note">
        {BRAND.drillLine}
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}
