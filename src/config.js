// Project Prahari — single source of truth for types, areas, panels, branding.
// The student dropdown and the Command panels both read from this file.

export const BRAND = {
  name: 'Project Prahari',
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

export const SOS_TYPES = [
  {
    id: 'medical', label: 'Medical', icon: '🏥', accent: '#0D9488',
    hint: 'Injury, collapse, breathing trouble',
    panelHint: 'Medical response panel',
  },
  {
    id: 'fire', label: 'Fire', icon: '🔥', accent: '#EA580C',
    hint: 'Smoke, flames, gas smell',
    panelHint: 'Fire response panel',
  },
  {
    id: 'safety', label: 'Safety', icon: '🛡️', accent: '#4F46E5',
    hint: 'Threat, harassment, immediate danger',
    panelHint: 'Security response panel',
  },
];

// Command board panels. Warden sees every type.
export const PANELS = [
  { id: 'medical', label: 'Medical', icon: '🏥', types: ['medical'], accent: '#0D9488' },
  { id: 'fire', label: 'Fire', icon: '🔥', types: ['fire'], accent: '#EA580C' },
  { id: 'security', label: 'Security', icon: '🛡️', types: ['safety'], accent: '#4F46E5' },
  { id: 'warden', label: 'Warden — All Types', icon: '👔', types: ['medical', 'fire', 'safety'], accent: '#B45309' },
];

// Hold-to-trigger duration for the student SOS button.
export const HOLD_MS = 2000;

// (V1.1) the siren is synthesized with the Web Audio API — 650/950 Hz yelp.
// No audio file is shipped; see src/command/Siren.js.

// Used ONLY by Command's "Simulate Burst" to jitter fake coordinates.
// Replace with your real campus center for a nicer demo.
export const CAMPUS_CENTER = { lat: 28.6139, lng: 77.2090 };

export const STATUS_META = {
  active: { label: 'ACTIVE', tone: 'red' },
  acknowledged: { label: 'ACKNOWLEDGED', tone: 'indigo' },
  resolved: { label: 'RESOLVED', tone: 'green' },
  cancelled: { label: 'CANCELLED', tone: 'slate' },
};

export const typeById = (id) => SOS_TYPES.find((t) => t.id === id) || { id, label: id, icon: '❓', accent: '#64748B' };
export const mapsUrl = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;
