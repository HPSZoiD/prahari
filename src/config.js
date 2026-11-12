// Project Prahari — single source of truth for types, areas, panels, branding.
// Field Report design system: paper + ink, vermilion seal for SOS only.
// No emoji. Icons are lucide-react names (resolved in JSX).

export const BRAND = {
  name: 'Prahari',
  tagline: 'Campus Safety Drill',
  drillLine: 'DRILL — training exercise. No real emergency services are contacted.',
};

// Area list = the grouping key. Order = dropdown order.
// 'Unspecified' is deliberately NOT here — it is the reserved bucket that
// raise_sos assigns when the student sends without picking an area.
export const AREAS = [
  'Block A', 'Block B', 'Hostel 1', 'Hostel 2',
  'Ground', 'Library', 'Auditorium', 'Canteen',
];

// Reserved bucket (must match supabase/schema.sql raise_sos).
export const UNSPECIFIED_AREA = 'Unspecified';

// How an incident's area was set. Display-only metadata.
export const LOCATION_SOURCE_META = {
  manual: { label: 'Area selected', cls: 'manual' },
  unspecified: { label: 'Location not specified', cls: 'unspecified' },
};

// SOS types — no emoji. `lucideIcon` is the lucide-react component name.
export const SOS_TYPES = [
  {
    id: 'medical', label: 'Medical', lucideIcon: 'HeartPulse',
    accent: '#C0392B',  // --medical
    hint: 'Injury, collapse, breathing trouble',
    panelHint: 'Medical response panel',
    icon: null,
  },
  {
    id: 'fire', label: 'Fire', lucideIcon: 'Flame',
    accent: '#C2611F',  // --fire
    hint: 'Smoke, flames, gas smell',
    panelHint: 'Fire response panel',
    icon: null,
  },
  {
    id: 'safety', label: 'Safety', lucideIcon: 'Shield',
    accent: '#2B4C7E',  // --safety
    hint: 'Threat, harassment, immediate danger',
    panelHint: 'Security response panel',
    icon: null,
  },
];

// Command board panels. Warden sees every type.
export const PANELS = [
  { id: 'medical',  label: 'Medical',  lucideIcon: 'HeartPulse', types: ['medical'],                   accent: '#C0392B' },
  { id: 'fire',     label: 'Fire',     lucideIcon: 'Flame',      types: ['fire'],                      accent: '#C2611F' },
  { id: 'security', label: 'Security', lucideIcon: 'Shield',     types: ['safety'],                    accent: '#2B4C7E' },
  { id: 'warden',   label: 'Warden — all types', lucideIcon: 'ScrollText', types: ['medical', 'fire', 'safety'], accent: '#4B4B48' },
];

// Hold-to-trigger duration for the student SOS button.
export const HOLD_MS = 2000;

// Used ONLY by Command's "Simulate Burst" to jitter fake coordinates.
export const CAMPUS_CENTER = { lat: 28.6139, lng: 77.2090 };

export const STATUS_META = {
  active:       { label: 'Active',        tone: 'red'    },
  acknowledged: { label: 'Acknowledged',  tone: 'amber'  },
  resolved:     { label: 'Resolved',      tone: 'green'  },
  cancelled:    { label: 'Cancelled',     tone: 'slate'  },
};

export const typeById = (id) => SOS_TYPES.find((t) => t.id === id) || { id, label: id, lucideIcon: 'AlertCircle', accent: '#857F75' };
export const mapsUrl = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;
