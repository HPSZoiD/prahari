import { isConfigured, isDemo } from './lib/supabase.js';
import StudentApp from './student/StudentApp.jsx';
import CommandApp from './command/CommandApp.jsx';
import { BRAND } from './config.js';

function SetupScreen() {
  return (
    <div className="setup-wrap">
      <div className="card setup-card">
        <h1>{BRAND.name}</h1>
        <p className="muted">{BRAND.tagline}</p>
        <h2>Connect Supabase</h2>
        <p className="muted small">
          Add <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>, then
          restart the dev server.
        </p>
        <p className="muted small">
          No project yet? Run <code>npm run dev:demo</code> for the in-browser
          mock backend.
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
