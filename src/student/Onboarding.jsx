import { useState } from 'react';
import { AREAS, BRAND } from '../config.js';
import { saveProfile, getSessionId, resetSession } from '../lib/session.js';

// One-time local onboarding. No account, no server — localStorage only.
export default function Onboarding({ initial, onDone }) {
  const [name, setName] = useState(initial?.name || '');
  const [roll, setRoll] = useState(initial?.roll || '');
  const [hostel, setHostel] = useState(initial?.hostel || '');
  const [room, setRoom] = useState(initial?.room || '');
  const [errors, setErrors] = useState({});
  const editing = Boolean(initial);

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!name.trim()) errs.name = 'Please enter your name';
    if (!roll.trim()) errs.roll = 'Please enter your roll number';
    if (!hostel) errs.hostel = 'Pick your hostel';
    if (room.trim() && !/^[A-Za-z0-9\-\s\/]{1,12}$/.test(room.trim())) {
      errs.room = 'Room number only (letters, digits, – /)';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    getSessionId();
    const profile = {
      name: name.trim(),
      roll: roll.trim(),
      hostel,
      room: room.trim(),
      saved_at: new Date().toISOString(),
    };
    saveProfile(profile);
    onDone(profile);
  };

  return (
    <main className="pr-page" style={{ justifyContent: 'center' }}>
      <header className="pr-brand pr-enter" style={{ '--i': 0 }}>
        <h1 className="pr-brand__title">{BRAND.name.toUpperCase()}</h1>
        <p className="pr-brand__role">Student</p>
      </header>

      <form className="pr-card pr-form-card pr-enter" style={{ '--i': 1 }} onSubmit={submit} noValidate>
        <h2 className="t-title pr-form-title">{editing ? 'Edit details' : 'Your details'}</h2>
        <p className="t-sub" style={{ margin: 0 }}>
          Stored on this device. Shared with Command only when you send a report.
        </p>

        <label className="pr-field" htmlFor="ob-name">
          <span className="pr-label">Full name</span>
          <input
            id="ob-name" className="pr-input" autoComplete="name" placeholder="e.g. Aarav Sharma"
            value={name} onChange={(e) => setName(e.target.value)}
          />
        </label>
        {errors.name && <div className="pr-err">{errors.name}</div>}

        <label className="pr-field" htmlFor="ob-roll">
          <span className="pr-label">Roll number</span>
          <input
            id="ob-roll" className="pr-input" placeholder="e.g. CS2K23-104" value={roll}
            onChange={(e) => setRoll(e.target.value)}
          />
        </label>
        {errors.roll && <div className="pr-err">{errors.roll}</div>}

        <label className="pr-field" htmlFor="ob-hostel">
          <span className="pr-label">Hostel</span>
          <select id="ob-hostel" className="pr-input" value={hostel} onChange={(e) => setHostel(e.target.value)}>
            <option value="">Select your hostel…</option>
            {AREAS.filter((a) => a.startsWith('Hostel')).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
            <option value="Day Scholar">Day Scholar (no hostel)</option>
          </select>
        </label>
        {errors.hostel && <div className="pr-err">{errors.hostel}</div>}

        <label className="pr-field" htmlFor="ob-room">
          <span className="pr-label">Room number (optional)</span>
          <input
            id="ob-room" className="pr-input" placeholder="e.g. B-214" value={room}
            onChange={(e) => setRoom(e.target.value)} maxLength={12}
          />
        </label>
        {errors.room && <div className="pr-err">{errors.room}</div>}

        <button type="submit" className="pr-btn pr-btn--primary">
          {editing ? 'Save changes' : 'Continue'}
        </button>
      </form>

      {editing && (
        <button
          type="button"
          className="pr-reset"
          onClick={() => { resetSession(); window.location.reload(); }}
        >
          Reset session (demo)
        </button>
      )}
    </main>
  );
}
