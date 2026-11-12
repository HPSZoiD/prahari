import { useEffect } from "react";
import { createPortal } from "react-dom";
import { helplinesByScope, CAMPUS } from "../data/campus.mjs";

export default function HelplineSheet({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const groups = [
    { label: "National emergency numbers", rows: helplinesByScope("national") },
    { label: `${CAMPUS.shortName} campus contacts`, rows: helplinesByScope("campus") },
  ];

  return createPortal(
    <div className="pr-scrim" role="dialog" aria-modal="true" aria-label="Emergency helplines" onClick={onClose}>
      <div className="pr-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pr-sheet__head">
          <div className="pr-handle" />
          <div className="pr-sheet__row">
            <div>
              <h2 className="pr-sheet__title">Emergency helplines</h2>
              <p className="pr-sheet__sub">Tap a number to call. Campus entries are sample data.</p>
            </div>
            <button type="button" className="pr-sheet__close" onClick={onClose} aria-label="Close emergency helplines">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="pr-sheet__body">
          {groups.map((g) => (
            <section key={g.label}>
              <p className="pr-group-label">{g.label}</p>
              {g.rows.map((h) => (
                <div className="pr-line" key={h.id}>
                  <div className="pr-line__info">
                    <p className="pr-line__label">{h.label}</p>
                    <p className="pr-line__note">{h.note}</p>
                  </div>
                  <a className="pr-call" href={`tel:${h.number.replace(/[^0-9+]/g, "")}`}>{h.number}</a>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
