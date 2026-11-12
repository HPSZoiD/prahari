import { useState } from 'react';
import { AREAS } from '../config.js';
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
    <div className="card onboard-card">
      <h1>{editing ? 'Edit details' : 'Your details'}</h1>
      <p className="onboard-sub">
        Stored on this device. Shared with Command only when you send a report.
      </p>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="ob-name">Full name</label>
          <input
            id="ob-name" autoComplete="name" placeholder="e.g. Aarav Sharma"
            value={name} onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <div className="err">{errors.name}</div>}
        </div>

        <div className="field">
          <label htmlFor="ob-roll">Roll number</label>
          <input
            id="ob-roll" placeholder="e.g. CS2K23-104" value={roll}
            onChange={(e) => setRoll(e.target.value)}
          />
          {errors.roll && <div className="err">{errors.roll}</div>}
        </div>

        <div className="field">
          <label htmlFor="ob-hostel">Hostel</label>
          <select id="ob-hostel" value={hostel} onChange={(e) => setHostel(e.target.value)}>
            <option value="">Select your hostel…</option>
            {AREAS.filter((a) => a.startsWith('Hostel')).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
            <option value="Day Scholar">Day Scholar (no hostel)</option>
          </select>
          {errors.hostel && <div className="err">{errors.hostel}</div>}
        </div>

        <div className="field">
          <label htmlFor="ob-room">Room number (optional)</label>
          <input
            id="ob-room" placeholder="e.g. B-214" value={room}
            onChange={(e) => setRoom(e.target.value)} maxLength={12}
          />
          {errors.room && <div className="err">{errors.room}</div>}
        </div>

        <button type="submit" className="btn btn-lg onboard-submit">
          {editing ? 'Save changes' : 'Continue'}
        </button>
      </form>

      {editing && (
        <button
          type="button"
          className="btn-ghost onboard-reset"
          onClick={() => { resetSession(); window.location.reload(); }}
        >
          Reset session (demo)
        </button>
      )}
    </div>
  );
}
