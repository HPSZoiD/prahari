const KEY = "prahari_assist_v1";
const MAX_STORED = 60;

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

export function loadThread() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-MAX_STORED);
  } catch {
    return [];
  }
}

export function saveThread(messages) {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX_STORED)));
  } catch { /* quota or private mode — non-fatal */ }
}

export function clearThread() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
