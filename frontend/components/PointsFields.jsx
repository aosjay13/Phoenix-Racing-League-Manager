"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ALL_BONUS_TYPES, BONUS_TYPES } from "@/lib/standings";
import { BANGER_BONUS_TYPES } from "@/lib/bangerRacing";
import { BUILTIN_TEMPLATES, tableToList } from "@/lib/pointsTemplates";
import { pointsFormToTemplate } from "@/lib/seasonForm";

// The Demo Derby / Banger Racing bonus values, as their own labelled block —
// rendered inside any points-structure editor that belongs to a banger series
// (a season, a class, a session's template, or the shared template library).
// The fields are generated from BANGER_BONUS_TYPES, so adding a new banger
// bonus in lib/bangerRacing.js adds it here with no change to this file.
export function BangerBonusFields({ value, onPatch, disabled = false }) {
  return (
    <div className="banger-bonus-block">
      <div className="banger-bonus-head">
        <span className="banger-chip">💥 Demo Derby / Banger Racing</span>
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Paid on top of finishing position. Takedowns pay <strong>per car</strong> put out; the
          two bonuses pay once to the driver who earns them.
        </span>
      </div>
      <div className="banger-bonus-grid">
        {BANGER_BONUS_TYPES.map(([key, label]) => (
          <div className="field" key={key}><label>{label}</label>
            <input type="number" min="0" disabled={disabled} value={value.bonuses[key] ?? "0"}
              onChange={e => onPatch({ bonuses: { ...value.bonuses, [key]: e.target.value } })} /></div>
        ))}
      </div>
    </div>
  );
}

// One points structure, as an editable block of fields: the template loader,
// the race scale, the qualifying scale (with its own loader, so qualifying can
// run a different template to the race), every bonus, and "save this setup as
// a template".
//
// Rendered by the Season form and by the Class form in League Setup, so a
// class's points structure is edited with exactly the same controls a season's
// is — the two can't drift apart, and a template loads the same way in both.
//
// State lives in the caller. `value` is { race_points, qual_points, bonuses }
// (comma-list strings + a bonus map of strings, straight off the inputs) and
// `onPatch` takes a partial of that shape. See lib/seasonForm.js for the
// serialization into what the API stores.
// `inherits` marks a structure that sits ON TOP of another — a class over its
// season. There, a blank scale falls through to the season rather than scoring
// 0, which is what the labels say and what classFormToBody stores.
//
// `banger` adds the Demo Derby / Banger Racing bonus values (Takedowns,
// Survival, Most Lethal — see lib/bangerRacing.js) to the bonus list. They're
// stored in every points structure regardless, but only a banger series'
// editors offer them, so an ordinary series' form is untouched.
// `afterScales` is an extra block rendered directly under the two scales, before
// the bonuses — for points settings that belong with Race Points and Qualifying
// Points rather than in a section of their own. The Season form puts the
// heat/consolation default templates there, so everything about how a season
// scores is in one place.
export function PointsFields({
  value, onPatch, templates = [], onTemplatesChanged,
  disabled = false, onError, noPoints = false, blankWarning = "", banger = false, inherits = false,
  seriesLevel = false, afterScales = null,
}) {
  // How a blank scale reads at this level: a class inherits its season, a
  // series simply sets nothing (its seasons keep their own), and a season —
  // the only level with nothing above it by default — scores 0.
  const blankMeans = seriesLevel ? " (blank = seasons keep their own)" : inherits ? " (blank = use the season's)" : " (blank = 0 points)";
  const [templateId, setTemplateId] = useState("");
  const [qualTemplateId, setQualTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");

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
    // A template that says nothing about the derby bonuses leaves them alone,
    // rather than resetting a takedown rate to 0 — the built-in racing
    // templates predate the mode and would otherwise wipe it every time one is
    // loaded. This mirrors how the scoring engine merges them (mergeBonuses).
    const derbyKeys = new Set(BANGER_BONUS_TYPES.map(([k]) => k));
    onPatch({
      race_points: (builtin ? builtin.race : tableToList(saved.race_points)) || "",
      qual_points: (builtin ? builtin.qual : tableToList(saved.qual_points)) || "",
      bonuses: Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => {
        if (derbyKeys.has(k) && !Number(bonusSrc[k] || 0)) return [k, String(value.bonuses?.[k] ?? 0)];
        return [k, String(bonusSrc[k] ?? 0)];
      })),
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
    onPatch({ qual_points: (builtin ? builtin.qual : tableToList(saved.qual_points)) || "" });
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

  return (
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

      <div className="field"><label>Race Points — comma-separated, 1st place first{blankMeans}</label>
        <textarea rows={3} disabled={disabled} value={value.race_points}
          placeholder="350, 320, 300, 280, 260, 250, 240, …"
          onChange={e => onPatch({ race_points: e.target.value })} />
        {noPoints && (
          <span style={{ fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)" }}>
            {blankWarning || "⚠ Blank scores 0 for every finishing position — load a template above if that isn’t what you want."}
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

      <div className="field"><label>Qualifying Points — comma-separated, pole first{blankMeans}</label>
        <textarea rows={2} disabled={disabled} value={value.qual_points}
          placeholder="35, 32, 30, 28, 26, 25, …"
          onChange={e => onPatch({ qual_points: e.target.value })} />
        {/* There's no Pole Bonus field any more — it paid for the same result as
            the first number here, so a season with both scored a pole twice. */}
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Pole is position 1 of this list — set what a pole is worth here; there is no separate pole
          bonus. The Qualifying session scores these points itself, as its own line of the
          championship, so a driver&rsquo;s total is the sum of every session they ran.
        </span></div>

      {afterScales}

      {BONUS_TYPES.map(([key, label]) => (
        <div className="field" key={key}><label>{label}</label>
          <input type="number" min="0" disabled={disabled} value={value.bonuses[key]}
            onChange={e => onPatch({ bonuses: { ...value.bonuses, [key]: e.target.value } })} /></div>
      ))}

      {banger && (
        <BangerBonusFields value={value} onPatch={onPatch} disabled={disabled} />
      )}

      <div className="field" style={{ marginTop: 4 }}>
        <label>Save Current Setup as Template</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={templateName} disabled={disabled} onChange={e => setTemplateName(e.target.value)}
            placeholder="e.g. PRA Standard, Sprint Cup" style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} onClick={saveAsTemplate}>Save</button>
        </div>
      </div>
    </>
  );
}
