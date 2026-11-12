// Local student identity — no auth, no signup (deliberate V1 decision).
// Profile + session UUID live in localStorage only.

const PROFILE_KEY = 'prahari_profile';
const SESSION_KEY = 'prahari_session';
const ACTIVE_KEY = 'prahari_active';
const FIX_KEY = 'prahari_last_fix';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function getProfile() { return readJSON(PROFILE_KEY); }
export function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }
export function clearProfile() { localStorage.removeItem(PROFILE_KEY); }

export function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = uuid(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

// Demo reuse: fresh session UUID + drop any active SOS reference.
export function resetSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  return getSessionId();
}

// Active SOS pointer: { incident_id, event_id, type, area, sent_at }
export function getActive() { return readJSON(ACTIVE_KEY); }
export function setActive(a) { localStorage.setItem(ACTIVE_KEY, JSON.stringify(a)); }
export function clearActive() { localStorage.removeItem(ACTIVE_KEY); }

// Last known GPS fix (written by lib/location.js)
export function getCachedFix() { return readJSON(FIX_KEY); }
export function setCachedFix(f) { localStorage.setItem(FIX_KEY, JSON.stringify(f)); }
