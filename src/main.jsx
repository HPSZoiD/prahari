import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initSupabase } from './lib/supabase.js';
import App from './App.jsx';
import './styles/base.css';
import './styles/student.css';
import './styles/command.css';

// The Supabase client (real or demo mock) must exist before first render —
// every component reads it at render time via the live binding.
initSupabase().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
