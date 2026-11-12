// Short vibration pulses (Android/Chrome). iOS Safari ignores this safely.
export function haptic(pattern = 8) {
  try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern); } catch {}
}
