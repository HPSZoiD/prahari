import { useEffect, useState } from 'react';
import { supabase, isDemo } from '../lib/supabase.js';
import Login from './Login.jsx';
import Board from './Board.jsx';

// Command entry: auth gate → board. `authenticated` == the one Command
// account; students are permanently anon.
export default function CommandApp() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data?.session?.user?.email) setEmail(data.session.user.email);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user?.email) setEmail(session.user.email);
      if (event === 'SIGNED_OUT') setEmail(null);
    });
    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  if (!ready) {
    return <div className="login-wrap"><span className="spinner" /></div>;
  }
  if (!email) return <Login onSignedIn={setEmail} />;
  return <Board email={email} onSignOut={() => {
    supabase.auth.signOut();
    setEmail(null);
  }} demo={isDemo} />;
}
