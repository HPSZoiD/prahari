const ENDPOINT = "/api/chat";
const MAX_TURNS = 12;
const MAX_CHARS = 2000;

export class AssistError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "AssistError";
    this.status = status;
  }
}

export async function streamAssist({ messages, signal, onDelta }) {
  const trimmed = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_CHARS) }));

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: trimmed }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new AssistError("Network unavailable. Check your connection and try again.");
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* ignore */ }
    throw new AssistError(msg, res.status);
  }

  if (!res.body) {
    const text = await res.text();
    if (text) onDelta(text, text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (!chunk) continue;
    full += chunk;
    onDelta(chunk, full);
  }

  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onDelta(tail, full);
  }

  if (!full.trim()) {
    throw new AssistError("The assistant returned an empty response. Try again.");
  }
  return full;
}
