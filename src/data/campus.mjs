// ─────────────────────────────────────────────────────────────
// PRAHARI ASSIST — KNOWLEDGE BASE
// SAMPLE DATA. Replace every value marked SAMPLE before real use.
// This file feeds BOTH the helpline UI and the model's system prompt.
// ─────────────────────────────────────────────────────────────

export const CAMPUS = {
  name: "Sample Institute of Technology",        // SAMPLE
  shortName: "SIT",                              // SAMPLE
  city: "Sample City",                           // SAMPLE
  securityHours: "24 hours, all days",
  healthCentreHours: "09:00–20:00 (Mon–Sat)",    // SAMPLE
  counsellingHours: "10:00–17:00 (Mon–Fri)",     // SAMPLE
};

// scope: "national" | "campus"
export const HELPLINES = [
  { id: "emergency",  label: "National Emergency",        number: "112",              scope: "national", note: "Police · Fire · Ambulance, single number", priority: 1 },
  { id: "ambulance",  label: "Ambulance",                 number: "108",              scope: "national", note: "Medical emergency transport", priority: 2 },
  { id: "fire",       label: "Fire Service",              number: "101",              scope: "national", note: "Fire and rescue", priority: 3 },
  { id: "police",     label: "Police",                    number: "100",              scope: "national", note: "Law enforcement", priority: 4 },
  { id: "women",      label: "Women's Helpline",          number: "1091",             scope: "national", note: "Women in distress", priority: 5 },
  { id: "mental",     label: "Tele-MANAS",                number: "14416",            scope: "national", note: "Mental health support, 24×7", priority: 6 },
  { id: "ragging",    label: "UGC Anti-Ragging",          number: "1800-180-5522",    scope: "national", note: "Toll-free, 24×7", priority: 7 },
  { id: "cyber",      label: "Cyber Fraud",               number: "1930",             scope: "national", note: "Financial cyber fraud", priority: 8 },
  { id: "child",      label: "Childline",                 number: "1098",             scope: "national", note: "Persons under 18", priority: 9 },

  { id: "security",   label: "Campus Security Control",   number: "+91-90000-00001",  scope: "campus", note: "Main gate control room, 24×7", priority: 1 }, // SAMPLE
  { id: "warden",     label: "Chief Warden",              number: "+91-90000-00002",  scope: "campus", note: "Hostel administration", priority: 2 },        // SAMPLE
  { id: "health",     label: "Campus Health Centre",      number: "+91-90000-00003",  scope: "campus", note: "Block C, ground floor", priority: 3 },        // SAMPLE
  { id: "counsel",    label: "Student Counsellor",        number: "+91-90000-00004",  scope: "campus", note: "Student Welfare Building, Room 104", priority: 4 }, // SAMPLE
  { id: "icc",        label: "Internal Complaints Committee", number: "+91-90000-00005", scope: "campus", note: "Harassment complaints", priority: 5 },   // SAMPLE
  { id: "antirag",    label: "Anti-Ragging Committee",    number: "+91-90000-00006",  scope: "campus", note: "Chairperson, Academic Block A", priority: 6 }, // SAMPLE
];

export const POLICIES = [
  {
    topic: "Medical emergency on campus",
    body: "Hold the SOS button and select Medical. Campus Security is alerted with your location. Health Centre is in Block C, ground floor. For anything life-threatening call 108 immediately and do not wait for a response in the app.",
  },
  {
    topic: "Fire or smoke",
    body: "Hold SOS and select Fire. Leave the building by the nearest marked exit, do not use lifts, and assemble at the marked assembly point on the main ground. Call 101 if the fire is spreading.",
  },
  {
    topic: "Ragging",
    body: "Ragging is prohibited and is a criminal offence. Report to the Anti-Ragging Committee, the Chief Warden, or the UGC toll-free helpline 1800-180-5522. Complaints may be made anonymously. Retaliation against a complainant is a separate disciplinary offence.",
  },
  {
    topic: "Sexual harassment",
    body: "Complaints go to the Internal Complaints Committee (ICC). Proceedings are confidential. If you are in immediate danger use SOS with Safety selected, or call 1091 / 112. You may bring a support person to any ICC meeting.",
  },
  {
    topic: "Feeling unsafe on campus",
    body: "Use SOS with Safety selected. Campus Security Control operates 24 hours. If you are being followed, move to a lit, populated area and stay on the line with Security.",
  },
  {
    topic: "Mental health and distress",
    body: "The Student Counsellor is available during counselling hours and appointments are confidential. Tele-MANAS (14416) is available 24×7 in multiple languages. If you are at immediate risk of harming yourself, call 112 or hold SOS now.",
  },
  {
    topic: "Hostel access and hours",
    body: "SAMPLE: Hostel entry closes at 22:30. Late entry requires written approval from the block warden. Visitors are permitted in the common room only, until 19:00.",
  },
  {
    topic: "Lost ID card or property",
    body: "Report to Campus Security Control. A written report is required for a duplicate ID card, issued from the Administrative Office within three working days.",
  },
  {
    topic: "What this app does and does not do",
    body: "Prahari sends an in-app alert to campus Command with your selected location and profile details. It does not place phone calls or send SMS. In a life-threatening situation, always call 112 or 108 directly in addition to using SOS.",
  },
];

export const SUGGESTED_PROMPTS = [
  "What do I do if someone is ragging me?",
  "Where is the health centre?",
  "I feel unsafe walking back to my hostel",
  "Who do I contact about harassment?",
  "Show me emergency numbers",
];

export const helplinesByScope = (scope) =>
  HELPLINES.filter((h) => h.scope === scope).sort((a, b) => a.priority - b.priority);

export function buildKnowledgeBlock() {
  const lines = [];
  lines.push(`INSTITUTION: ${CAMPUS.name} (${CAMPUS.shortName}), ${CAMPUS.city}`);
  lines.push(`Security hours: ${CAMPUS.securityHours}`);
  lines.push(`Health Centre hours: ${CAMPUS.healthCentreHours}`);
  lines.push(`Counselling hours: ${CAMPUS.counsellingHours}`);
  lines.push("");
  lines.push("HELPLINES — these are the ONLY numbers you may state:");
  for (const h of [...HELPLINES].sort((a, b) => a.priority - b.priority)) {
    lines.push(`- ${h.label}: ${h.number} [${h.scope}] — ${h.note}`);
  }
  lines.push("");
  lines.push("CAMPUS POLICY AND PROCEDURE:");
  for (const p of POLICIES) {
    lines.push(`- ${p.topic}: ${p.body}`);
  }
  return lines.join("\n");
}
