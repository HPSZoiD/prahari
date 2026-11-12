import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import "@fontsource-variable/inter/wght.css";
import './styles/legacy.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/command.css';
import { initSupabase } from './lib/supabase.js';
import App from './App.jsx';

// The Supabase client (real or demo mock) must exist before first render —
// every component reads it at render time via the live binding.
initSupabase().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
