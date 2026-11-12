// ONE shared siren loop, derived from "any active incident exists".
// Never one sound per alert.
//
// V1.1: synthesized with the Web Audio API instead of an <audio>/mp3 file.
// The mp3 approach was fragile — a stalled load or a play() promise that
// never resolved left the siren (and the Test button) dead. An oscillator
// cannot fail to load: if audio is unlocked, it always sounds.
//
// Two-tone yelp, same character as the old file: 650 Hz and 950 Hz
// alternating every 400 ms, 10 ms fades to kill clicks, forever until stop.

let ctx = null;      // lazily created AudioContext (one per board)
let osc = null;      // the single siren oscillator
let gain = null;     // master gain
let timer = null;    // tone-alternation scheduler
let high = false;    // which tone is playing
let running = false;

const LOW_HZ = 650;
const HIGH_HZ = 950;
const TOGGLE_MS = 400;

function getCtx() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

function setTone(hz, when) {
  // 10 ms fades around each switch keep the yelp click-free.
  gain.gain.cancelScheduledValues(when);
  gain.gain.setValueAtTime(gain.gain.value, when);
  gain.gain.linearRampToValueAtTime(0.0001, when + 0.01);
  osc.frequency.setValueAtTime(hz, when + 0.01);
  gain.gain.linearRampToValueAtTime(0.55, when + 0.02);
}

function startLoop() {
  high = false;
  osc.frequency.setValueAtTime(LOW_HZ, ctx.currentTime);
  gain.gain.setValueAtTime(0.55, ctx.currentTime);
  timer = setInterval(() => {
    high = !high;
    setTone(high ? HIGH_HZ : LOW_HZ, ctx.currentTime);
  }, TOGGLE_MS);
}

function stopNodes() {
  if (timer) { clearInterval(timer); timer = null; }
  if (osc) { try { osc.stop(); } catch { /* already stopped */ } osc.disconnect(); osc = null; }
  if (gain) { gain.disconnect(); gain = null; }
}

// Call once from a real user gesture (the GO ON DUTY click). Creates/resumes
// the AudioContext — the browser's autoplay policy unlock. Never awaited in
// a way that can hang the UI: failure just means sync() will retry.
export async function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === 'suspended') await c.resume();
    // A zero-volume blip proves the context can really produce audio.
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.02);
  } catch { /* blocked — sync()/testSiren() retry on later gestures */ }
}

// Derived state: exactly one loop when (anyActive && onDuty).
export function syncSiren(anyActive, onDuty) {
  const shouldRun = anyActive && onDuty;
  if (shouldRun && !running) {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') { c.resume().catch(() => {}); }
    osc = c.createOscillator();
    gain = c.createGain();
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(c.destination);
    try { startLoop(); osc.start(); running = true; }
    catch { stopNodes(); }
  } else if (!shouldRun && running) {
    stopNodes();
    running = false;
  }
}

// Demo-day AV check: a short two-tone sample, never disabled — pressing it
// is itself a user gesture, so it doubles as an audio unlock retry.
export function testSiren() {
  if (running) return; // the real siren is already sounding
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.connect(g); g.connect(c.destination);
  const t0 = c.currentTime;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.55, t0 + 0.02);
  o.frequency.setValueAtTime(LOW_HZ, t0);
  o.frequency.setValueAtTime(HIGH_HZ, t0 + 0.45);
  o.frequency.setValueAtTime(LOW_HZ, t0 + 0.9);
  g.gain.setValueAtTime(0.55, t0 + 1.15);
  g.gain.linearRampToValueAtTime(0.0001, t0 + 1.2);
  try { o.start(t0); o.stop(t0 + 1.22); } catch { /* context blocked */ }
}

// Page unload safety: never leave an oscillator running.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (running) { stopNodes(); running = false; } });
}
