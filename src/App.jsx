import { isConfigured, isDemo } from './lib/supabase.js';
import StudentApp from './student/StudentApp.jsx';
import CommandApp from './command/CommandApp.jsx';
import { BRAND } from './config.js';

function SetupScreen() {
  return (
    <div className="setup-wrap">
      <div className="card setup-card">
        <div className="setup-shield" aria-hidden="true">🛡️</div>
        <h1>{BRAND.name}</h1>
        <p className="muted">{BRAND.tagline}</p>
        <h2>One step left: connect Supabase</h2>
        <ol className="setup-steps">
          <li>Create a free project at <strong>supabase.com</strong>.</li>
          <li>SQL Editor → run <code>supabase/schema.sql</code>.</li>
          <li>Copy the project URL + <em>anon</em> key into <code>.env</code>
            (see <code>.env.example</code>).</li>
          <li>Restart <code>npm run dev</code>.</li>
        </ol>
        <p className="muted small">
          No Supabase account yet? Run <code>npm run dev:demo</code> for the
          in-browser mock backend (rehearsal only).
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const isCommand = window.location.pathname.startsWith('/command');
  if (!isConfigured) return <SetupScreen />;
  return isCommand ? <CommandApp /> : <StudentApp />;
}

// Demo-mode badge (never rendered in production builds — isDemo is statically
// replaced with false and this branch is dead-code eliminated).
export function DemoBadge() {
  return isDemo ? <span className="demo-badge">MOCK BACKEND</span> : null;
}
