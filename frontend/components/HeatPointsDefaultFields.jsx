"use client";

import { NONE_TEMPLATE } from "@/lib/pointsTemplates";

// What "every heat" means at the level these fields are rendered at, and what
// overrides what. Three levels carry the same pair of defaults:
//
//   season  — every heat of every event in the season (League Setup → Seasons)
//   class   — every heat this one class runs (League Setup → Classes)
//   event   — every heat of one event (Race Info, all three race forms)
//
// Most specific wins: the event's default beats the class's, which beats the
// season's, and a template assigned to ONE session from its own results tab
// beats all three. Whichever level names it, the template sits ON TOP of a
// class's own points structure: heats and consolations score nothing until
// somebody names a points system for them, so a class's structure — its answer
// to what a FINISH pays — is not a competing statement about them. See
// inheritedSessionTemplate and makeScorer in lib/standings.js.
const SCOPES = {
  event: {
    heat: "Every heat of this event scores on this, so heats never need a template picked one at a time.",
    consolation: "Same for this event’s consolation races.",
    overrides: "A single session can still be re-pointed on its own results tab, which overrides this.",
  },
  season: {
    heat: "Every heat of every event in this season scores on this — one pick for the whole year instead of one per race entry.",
    consolation: "Same for every consolation race in the season.",
    overrides: "A class, a single event, or one session can each override this for what they cover — and it sits on top of a class’s own points structure, so a class scoring its own points still pays it.",
  },
  class: {
    heat: "Every heat this class runs scores on this, at every event in the season.",
    consolation: "Same for every consolation race this class runs.",
    overrides: "This sits on top of the class’s own points structure, so a class scoring its own points still pays these. A single event or session can override it.",
  },
};

// The two DEFAULT points templates a heat-racing scope can name: one for every
// heat, one for every consolation (B-Main, C-Main…). Rendered wherever heat
// racing is ticked — the Race Info form of all three race screens, the Season
// form, and the Class form — directly under the tick that unlocks them.
//
// Why they exist: the points system used to be assignable only per session, from
// the results screen. A weekend with eight heats and two B-Mains therefore meant
// ten trips through a dropdown, repeated for every round of the season. Named
// here, the template is picked once and every heat (or every consolation) in
// scope scores on it — including sessions added later, since nothing is copied
// onto the sessions themselves.
//
// `templates` is the flat list of pickable points systems (built-ins + the
// league's saved templates), same as the per-session dropdown offers.
export function HeatPointsDefaultFields({
  value, onPatch, templates = [], disabled = false, idPrefix = "race", scopeLabel = "event",
}) {
  const copy = SCOPES[scopeLabel] || SCOPES.event;
  const rows = [
    ["heat_points_template_id", "Default points template for every Heat", copy.heat],
    ["consolation_points_template_id", "Default points template for every Consolation (B-Main, C-Main…)", copy.consolation],
  ];

  // A default pointing at a template that has since been deleted resolves to
  // nothing at scoring time, so those heats quietly score the season's race
  // scale. Left to itself the box would snap to "No default" and read as though
  // nothing were set — so the dangling pick stays visible and is called out.
  const missing = id => !!id && id !== NONE_TEMPLATE.id && !templates.some(t => t.id === id);

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
            {missing(value[field]) && <option value={value[field]}>⚠ Deleted points system</option>}
          </select>
          {missing(value[field]) && (
            <span style={{ fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)" }}>
              ⚠ This template has been deleted, so these sessions are scoring the season / class points. Pick one again.
            </span>
          )}
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>{hint}</span>
        </div>
      ))}
      <p style={{ fontSize: "0.78rem", color: "var(--ink-2)", margin: "-2px 0 10px" }}>
        Naming a default also makes that session type <strong>count toward championship points</strong> —
        heats and consolations pay nothing by default. {copy.overrides} Each session keeps its own points
        switch on its results tab if you want to exclude one.
      </p>
    </>
  );
}
