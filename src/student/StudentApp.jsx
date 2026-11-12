import { useEffect, useState } from 'react';
import { BRAND } from '../config.js';
import { getProfile, getActive } from '../lib/session.js';
import { useToasts, Toasts } from '../lib/ui.jsx';
import Onboarding from './Onboarding.jsx';
import Dashboard from './Dashboard.jsx';
import ActiveSOS from './ActiveSOS.jsx';
import StudentShell from './StudentShell.jsx';

// Student entry point. Local identity only — no signup, ever.
export default function StudentApp() {
  const [profile, setProfile] = useState(() => getProfile());
  const [active, setActive] = useState(() => getActive());
  const [editing, setEditing] = useState(false);
  const { toasts, push } = useToasts();

  // V1 → V1.1 migration: old profiles had `area` (usual area). The selector
  // is now per-SOS, so drop the stale field and ask for hostel on next edit.
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
    push('Profile saved on this device. Ready when you are.');
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
    if (status === 'resolved') push('Incident resolved. Thank you.', 'success');
    else if (status === 'cancelled') push('Report withdrawn.');
    else push('Drill ended.');
  };

  const header = (
    <header className="pr-brand pr-enter" style={{ '--i': 0 }}>
      <h1 className="pr-brand__title">{BRAND.name.toUpperCase()}</h1>
      <p className="pr-brand__role">Student</p>
    </header>
  );

  // Onboarding stays outside the shell so the bottom nav does not appear
  // before a profile exists.
  if (!profile || editing) {
    return (
      <>
        <Onboarding initial={profile} onDone={handleOnboard} />
        <Toasts toasts={toasts} />
      </>
    );
  }

  return (
    <>
      <StudentShell
        alertActive={Boolean(active)}
        sos={
          <div className="pr-page">
            {header}
            {active ? (
              <ActiveSOS active={active} profile={profile} onEnded={handleEnded} />
            ) : (
              <Dashboard
                profile={profile}
                onFired={handleFired}
                onEdit={() => setEditing(true)}
              />
            )}
          </div>
        }
      />
      <Toasts toasts={toasts} className="pr-toasts" />
    </>
  );
}
