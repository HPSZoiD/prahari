import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// V1 build: plain SPA, no proxy needed — the Supabase client talks
// directly to Postgres + Realtime. Netlify Functions stay empty in V1.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { outDir: 'dist' },
});
