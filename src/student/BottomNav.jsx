import { ShieldAlert, MessageSquare } from "lucide-react";
import { haptic } from "../lib/haptic.js";

const TABS = [
  { id: "sos", label: "SOS", Icon: ShieldAlert },
  { id: "assist", label: "Assist", Icon: MessageSquare },
];

export default function BottomNav({ tab, onTab, alertActive }) {
  const idx = Math.max(TABS.findIndex((t) => t.id === tab), 0);

  return (
    <nav
      className="pr-tabbar glass"
      style={{ "--n": TABS.length, "--idx": idx }}
      aria-label="Primary"
    >
      <span className="pr-tabbar__lens" aria-hidden="true" />
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="pr-tab"
          data-tone={id === "sos" ? "sos" : undefined}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => { onTab(id); haptic(6); }}
        >
          <span className="pr-tab__icon">
            <Icon size={24} strokeWidth={1.75} />
            {id === "sos" && alertActive && <span className="pr-dot" aria-hidden="true" />}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
