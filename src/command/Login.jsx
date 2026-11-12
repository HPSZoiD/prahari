import { useState } from 'react';
import { BRAND } from '../config.js';
import { supabase } from '../lib/supabase.js';

// The ONE pre-provisioned Command account (signups are disabled in Supabase).
export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(err.message || 'Sign-in failed. Check the credentials.');
      return;
    }
    onSignedIn(email);
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="login-brand">
          <span className="brand-icon" aria-hidden="true">🛡️</span>
          <div>
            <h1>{BRAND.name}</h1>
            <div className="muted small" style={{ fontWeight: 700 }}>PRAHARI COMMAND · DRILL</div>
          </div>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="cmd-email">Command email</label>
            <input
              id="cmd-email" type="email" autoComplete="username"
              placeholder="command@yourcollege.edu" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cmd-pw">Password</label>
            <input
              id="cmd-pw" type="password" autoComplete="current-password"
              placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="chip chip-red" style={{ marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="btn btn-lg" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Open Command Board'}
          </button>
        </form>

        <div className="login-note">
          Single operator account — student signups are disabled by design.
          Students never log in; they just open the app link.
        </div>
        <p className="muted small" style={{ marginTop: 12, textAlign: 'center' }}>
          {BRAND.drillLine}
        </p>
      </div>
    </div>
  );
}
