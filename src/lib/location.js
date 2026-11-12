// Cached-first location. NEVER block an SOS on a GPS fix:
//   1. Dashboard mount → silent watchPosition, cache every fix.
//   2. On SOS → send the cached fix immediately (or none — grouping uses area).
//   3. After send → high-accuracy getCurrentPosition → update_sos_location.

import { getCachedFix, setCachedFix } from './session.js';

let lastFix = null;
let watchStatus = 'idle'; // idle | watching | denied | unavailable
let watcherId = null;

export function getLocationStatus() { return watchStatus; }
export function peekFix() { return lastFix; }

export function startWarmWatch() {
  if (watcherId != null || !('geolocation' in navigator)) {
    if (!('geolocation' in navigator)) watchStatus = 'unavailable';
    return;
  }
  watchStatus = 'watching';
  watcherId = navigator.geolocation.watchPosition(
    (pos) => {
      watchStatus = 'watching';
      lastFix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        ts: pos.timestamp,
      };
      setCachedFix(lastFix);
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) watchStatus = 'denied';
      else watchStatus = 'unavailable';
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
}

export function stopWarmWatch() {
  if (watcherId != null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(watcherId);
    watcherId = null;
  }
}

// Memory first, then localStorage. Returns null when we have nothing.
export function cachedFix() {
  if (lastFix) return lastFix;
  const stored = getCachedFix();
  if (stored) lastFix = stored;
  return lastFix;
}

// High-accuracy one-shot used AFTER the SOS is already out the door.
export function refineLocation(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          ts: pos.timestamp,
        };
        lastFix = fix;
        setCachedFix(fix);
        resolve(fix);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
