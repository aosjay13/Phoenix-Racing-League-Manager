"use client";

import { NONE_TEMPLATE } from "@/lib/pointsTemplates";

// The two DEFAULT points templates a heat-racing event can name: one for every
// heat, one for every consolation (B-Main, C-Main…). Rendered inside the Race
// Info form of all three places a heat event is set up — League Setup's Races
// panel, the New Race dialog, and the event's own Race Info tab — right under
// the heat/consolation session lists they apply to.
//
// Why they exist: the points system used to be assignable only per session, from
// the results screen. A weekend with eight heats and two B-Mains therefore meant
// ten trips through a dropdown, repeated for every round of the season. Named
// here, the template is picked once for the event and every heat (or every
// consolation) scores on it — including sessions added later, since nothing is
// copied onto the sessions themselves.
//
// A single session can still be re-pointed from the results screen; that
// assignment overrides its type's default. See resolveTemplateId in
// lib/standings.js for the chain, and note that naming a default also turns
// championship points on for that session type, which is off by default for
// preliminary sessions.
//
// `templates` is the flat list of pickable points systems (built-ins + the
// league's saved templates), same as the per-session dropdown offers.
export function HeatPointsDefaultFields({ value, onPatch, templates = [], disabled = false, idPrefix = "race" }) {
  const rows = [
    ["heat_points_template_id", "Default points template for every Heat",
     "Every heat of this event scores on this, so heats never need a template picked one at a time. Leave it on “No default” to keep them scoring on the season’s (or class’s) points structure."],
    ["consolation_points_template_id", "Default points template for every Consolation (B-Main, C-Main…)",
     "Same for the consolation races. A single session can still be re-pointed on its own tab, which overrides this."],
  ];

  return (
    <>
      {rows.map(([field, label, hint]) => (
        <div className="field" key={field}>
          <label htmlFor={`${idPrefix}_${field}`}>{label}</label>
          <select id={`${idPrefix}_${field}`} disabled={disabled} value={value[field] || ""}
            onChange={e => onPatch({ [field]: e.target.value })}>
            <option value="">No default — use the season / class points</option>
            <option value={NONE_TEMPLATE.id}>{NONE_TEMPLATE.name}</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>{hint}</span>
        </div>
      ))}
      <p style={{ fontSize: "0.78rem", color: "var(--ink-2)", margin: "-2px 0 10px" }}>
        Naming a default also makes that session type <strong>count toward championship points</strong> —
        heats and consolations pay nothing by default. Each session keeps its own points switch on its
        results tab if you want to exclude one.
      </p>
    </>
  );
}
