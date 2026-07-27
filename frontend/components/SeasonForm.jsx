"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ImageUpload } from "@/components/ImageUpload";
import { BONUS_TYPES } from "@/lib/standings";
import { BUILTIN_TEMPLATES, listToTableOrZero, tableToList } from "@/lib/pointsTemplates";
import { pointsFormToTemplate, scoresNoPoints } from "@/lib/seasonForm";

// Every season field, in one place. Rendered identically by League Setup's
// Seasons panel and by the Schedule page's "+ New Season" dialog, so the two
// can never offer different options — which is the whole point of it being a
// component rather than JSX copied into each screen.
//
// It renders only the fields; the surrounding <form>, submit button and save
// call belong to the caller, which knows whether it's creating or editing.
// State lives in the caller too (`value` / `onChange`) so the caller can seed
// it from an existing season — see lib/seasonForm.js for the shape.
export function SeasonForm({
  value, onChange, templates = [], onTemplatesChanged,
  disabled = false, defaultPointsOpen = false, onError,
}) {
  const [showPoints, setShowPoints] = useState(defaultPointsOpen);
  const [templateId, setTemplateId] = useState("");
  const [qualTemplateId, setQualTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");

  const set = patch => onChange(f => ({ ...f, ...patch }));
  const field = name => e => set({ [name]: e.target.value });
  const check = name => e => set({ [name]: e.target.checked });
  const fail = msg => (onError ? onError(msg) : alert(msg));

  // Load a whole template: race scale, qualifying scale and bonuses together.
  function applyTemplate(id) {
    setTemplateId(id);
    setQualTemplateId("");   // a full-template load also sets qualifying points
    const builtin = BUILTIN_TEMPLATES.find(x => x.id === id);
    const saved = templates.find(x => x.id === id);
    if (!builtin && !saved) return;
    let bonusSrc = builtin ? builtin.bonuses : (saved.bonus_points || {});
    if (typeof bonusSrc === "string") { try { bonusSrc = JSON.parse(bonusSrc); } catch { bonusSrc = {}; } }
    set({
      race_points: (builtin ? builtin.race : tableToList(saved.race_points)) || "",
      qual_points: (builtin ? builtin.qual : tableToList(saved.qual_points)) || "",
      bonuses: Object.fromEntries(BONUS_TYPES.map(([k]) => [k, String(bonusSrc[k] ?? 0)])),
    });
  }

  // Load ONLY the qualifying scale, leaving race points and bonuses alone — so
  // qualifying can run a different template to the race.
  function applyQualTemplate(id) {
    setQualTemplateId(id);
    if (!id) return;
    const builtin = BUILTIN_TEMPLATES.find(x => x.id === id);
    const saved = templates.find(x => x.id === id);
    if (!builtin && !saved) return;
    set({ qual_points: (builtin ? builtin.qual : tableToList(saved.qual_points)) || "" });
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return fail("Give the template a name first.");
    try {
      await api("/api/points-templates", { method: "POST", body: pointsFormToTemplate(value, templateName.trim()) });
      setTemplateName("");
      onTemplatesChanged?.();
    } catch (err) { fail(err.message); }
  }

  async function deleteTemplate() {
    const t = templates.find(x => x.id === templateId);
    if (!t || !confirm(`Delete template "${t.name}"? Seasons already using it keep their saved points.`)) return;
    try {
      await api(`/api/points-templates/${t.id}`, { method: "DELETE" });
      setTemplateId("");
      onTemplatesChanged?.();
    } catch (err) { fail(err.message); }
  }

  // Blank race points are legal but almost always a slip, so say so up front
  // rather than letting a season quietly score nothing all year.
  const noPoints = scoresNoPoints(value);

  return (
    <>
      <div className="field"><label>Season Name</label>
        <input required disabled={disabled} value={value.name} onChange={field("name")} placeholder="Season 3" /></div>

      <div className="field"><label>Drop Weeks (worst results ignored)</label>
        <input type="number" min="0" disabled={disabled} value={value.drop_weeks} onChange={field("drop_weeks")} /></div>

      <div className="field"><label>Car Type</label>
        <input disabled={disabled} value={value.car} onChange={field("car")} placeholder="e.g. NASCAR Next Gen, GT3" />
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          The car this season races. Classes and individual races both default to this — override it
          per class, or per race.
        </span></div>

      <ImageUpload label="Season Logo" kind="season-logo" value={value.logo_url} onUploaded={url => set({ logo_url: url })} />

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id="season_combined_championship" disabled={disabled}
          checked={value.combined_championship} onChange={check("combined_championship")}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor="season_combined_championship" style={{ margin: 0 }}>
          Enable Overall Championship
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            For a season split into classes: also crown ONE overall champion across the whole
            field, on top of each class&rsquo;s own championship. Turn it off for class-only
            championships — the combined &ldquo;All Classes&rdquo; table stays viewable, just
            flagged as unofficial. No effect on a season without classes.
          </span>
        </label>
      </div>

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id="season_per_class_schedules" disabled={disabled}
          checked={value.per_class_schedules} onChange={check("per_class_schedules")}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor="season_per_class_schedules" style={{ margin: 0 }}>
          Per-Class Schedules
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): every class runs the same season schedule. On: each race can be
            pinned to one class, so classes can run their own calendars — races left on
            &ldquo;All Classes&rdquo; stay shared, so you can mix a common opener with
            class-specific rounds. Turning it off later doesn&rsquo;t delete anything; pinned
            races simply go back to showing for everyone.
          </span>
        </label>
      </div>

      <div className="field" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row" }}>
        <input type="checkbox" id="season_per_class_results" disabled={disabled}
          checked={value.per_class_results} onChange={check("per_class_results")}
          style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent-cyan)" }} />
        <label htmlFor="season_per_class_results" style={{ margin: 0 }}>
          Separate Results by Class
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Off (default): all classes at an event share one results grid, with a Class column
            per row — one outright winner. On: even when every class races the same round, each
            class gets its <strong>own</strong> Qualifying and Race, with its own pole, its own
            P1 and its own field. This is the default for new events; any single event can be
            flipped either way on its Race Info tab. With no single outright order, the overall
            championship above just adds the classes&rsquo; points together — turn it off for a
            pure class-championship season.
          </span>
        </label>
      </div>

      <button type="button" className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setShowPoints(v => !v)}>
        {showPoints ? "▾" : "▸"} Points &amp; Bonuses
      </button>
      {!showPoints && noPoints && (
        <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)" }}>
          ⚠ No race points set — every finish would score 0. Open Points &amp; Bonuses and load a template.
        </p>
      )}

      {showPoints && (
        <>
          <div className="field">
            <label>Load Template (race + qualifying + bonuses)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={templateId} disabled={disabled} onChange={e => applyTemplate(e.target.value)} style={{ flex: 1 }}>
                <option value="">Custom / start blank…</option>
                <optgroup label="Standard">
                  {BUILTIN_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label="My Templates">
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                )}
              </select>
              {templateId && templates.some(t => t.id === templateId) && (
                <button type="button" className="btn btn-danger" style={{ marginTop: 0, padding: "6px 12px" }} onClick={deleteTemplate}>✕</button>
              )}
            </div>
          </div>

          <div className="field"><label>Race Points — comma-separated, 1st place first (blank = 0 points)</label>
            <textarea rows={3} disabled={disabled} value={value.race_points}
              placeholder="350, 320, 300, 280, 260, 250, 240, …" onChange={field("race_points")} />
            {noPoints && (
              <span style={{ fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)" }}>
                ⚠ Blank scores 0 for every finishing position — load a template above if that isn&rsquo;t what you want.
              </span>
            )}
          </div>

          <div className="field">
            <label>Load Qualifying Points Template</label>
            <select value={qualTemplateId} disabled={disabled} onChange={e => applyQualTemplate(e.target.value)}>
              <option value="">Custom / keep current…</option>
              <optgroup label="Standard">
                {BUILTIN_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
              {templates.length > 0 && (
                <optgroup label="My Templates">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              )}
            </select>
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              Fills only the qualifying scale below from the chosen template, so qualifying can score on its own template.
            </span>
          </div>

          <div className="field"><label>Qualifying Points — comma-separated, pole first (blank = 0 points)</label>
            <textarea rows={2} disabled={disabled} value={value.qual_points}
              placeholder="35, 32, 30, 28, 26, 25, …" onChange={field("qual_points")} /></div>

          {BONUS_TYPES.map(([key, label]) => (
            <div className="field" key={key}><label>{label}</label>
              <input type="number" min="0" disabled={disabled} value={value.bonuses[key]}
                onChange={e => set({ bonuses: { ...value.bonuses, [key]: e.target.value } })} /></div>
          ))}

          <div className="field">
            <label>Save Current Setup as Template</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={templateName} disabled={disabled} onChange={e => setTemplateName(e.target.value)}
                placeholder="e.g. PRA Standard, Sprint Cup" style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={saveAsTemplate}>Save</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
