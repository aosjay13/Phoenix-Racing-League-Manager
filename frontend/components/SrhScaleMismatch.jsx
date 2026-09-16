"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { NONE_TEMPLATE, normalizedBuiltinTemplates } from "@/lib/pointsTemplates";
import { scaleSummary, scaleToTemplate } from "@/lib/srhPointsScale";

// "SimRacerHub scored this differently from you" — and what to do about it.
//
// The importer never brings finishing points across: this season's own points
// structure pays for every position, which is what keeps one scorer. That is
// the right rule and it is also a silent one. A league whose SimRacerHub season
// pays 75 for a win while this app's default pays 100 imports twelve rounds
// that all look fine and produces a championship nobody recognises — and the
// first anyone hears of it is a driver asking why the table disagrees with the
// site they raced on.
//
// So the two scales are compared per session and the disagreement is put in
// front of the admin with the decision attached. What they choose is a points
// structure for that session, which is a thing this app already has: it is
// stored on the event as `session_points`, exactly as the results screen's own
// points picker stores it, so it keeps scoring that way afterwards and can be
// changed from that screen like any other event's.
//
// One round differing is an exception to fix on that round. Most of them
// differing is the league's scale, and asking the same question twelve times
// would be the wrong shape — so a season-wide disagreement gets one control
// that answers all of them at once.
//
// And because the league this matters most to is the one whose scale this app
// has never been told about, SimRacerHub's own scale can be saved as a
// structure in one press. Without that the flag is a dead end: told the scales
// disagree, offered a list that doesn't contain the right one, and sent off to
// type thirty positions in by hand from the site being imported from.
export function SrhScaleMismatch({
  report, choices = {}, onChoose, onChooseAll, onError,
}) {
  const [saved, setSaved] = useState([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => { reload().catch(() => {}); }, []);
  async function reload() {
    const list = await api("/api/points-templates");
    setSaved(list || []);
    return list || [];
  }

  // The same list every points picker in the app offers: the built-in
  // structures, the league's saved ones, and "No Points".
  const templates = useMemo(
    () => [...normalizedBuiltinTemplates(), ...saved].sort((a, b) => a.name.localeCompare(b.name)),
    [saved],
  );

  const flagged = report?.flagged || [];

  // What the season-wide control shows: the choice if every flagged session
  // shares one, blank while they differ. A control that reset itself after
  // being used would read as though nothing had happened.
  const everySession = flagged.flatMap(r => [...r.sessions, ...r.unscored].map(s => [r.race_id, s.session]));
  const picked = everySession.map(([raceId, session]) => choices[raceId]?.[session] || "");
  const sharedChoice = picked.length && picked.every(v => v === picked[0]) ? picked[0] : "";

  if (!flagged.length) return null;

  // The scale to build a new structure from when answering the whole season at
  // once: the first flagged session read, which is the one the summary line
  // above the control is quoting.
  const firstSession = flagged[0]?.sessions?.[0] || null;

  async function createFrom(session, label) {
    if (!session?.scale?.srh_scale) return;
    setBusy(label);
    setNote("");
    try {
      const body = scaleToTemplate(session.scale.srh_scale, label, { sessionType: session.session_type });
      const created = await api("/api/points-templates", { method: "POST", body });
      await reload();
      setNote(`Saved “${created.name}”. It is picked below, and is now offered anywhere else you set points.`);
      return created.id;
    } catch (err) {
      onError?.(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  const picker = (value, onChange, key) => (
    <select value={value || ""} onChange={e => onChange(e.target.value)} disabled={!!busy}
      style={{ minWidth: 220 }} key={key}>
      <option value="">— leave it on your own structure —</option>
      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      <option value={NONE_TEMPLATE.id}>{NONE_TEMPLATE.name}</option>
    </select>
  );

  return (
    <div style={{ border: "1.5px solid var(--accent-amber, #d29922)", borderRadius: 10, padding: "12px 14px", margin: "14px 0", background: "var(--bg-elevated)" }}>
      <strong style={{ fontSize: "0.92rem" }}>
        SimRacerHub scored {flagged.length} of {report.read} round{report.read === 1 ? "" : "s"} differently from your points structure
      </strong>
      <p style={{ margin: "4px 0 10px", fontSize: "0.8rem", color: "var(--ink-1)" }}>
        The import doesn&rsquo;t bring finishing points across — your own structure pays for every position, which
        is what keeps one scorer. So where SimRacerHub paid a different scale, the imported round will score
        <em> your </em> numbers rather than the ones on the site. Name the structure each round should score
        on, or leave it and your default stands.
      </p>

      {/* One round differing is that round's business. Most of them differing
          is the league's scale, and one control should answer it. */}
      {report.season_wide && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
          <div style={{ fontSize: "0.82rem", marginBottom: 6 }}>
            <strong>Most of the season is scored this way.</strong> Set one structure on every round flagged below:
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {picker(sharedChoice, id => onChooseAll?.(id), "all")}
            {firstSession && (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} disabled={!!busy}
                title="Save what SimRacerHub paid as a points structure, and set every flagged round to score on it"
                onClick={async () => {
                  const id = await createFrom(firstSession, `SimRacerHub · ${report.season_name || "season"}`);
                  if (id) onChooseAll?.(id);
                }}>
                {busy ? "Saving…" : "＋ Use SimRacerHub's own scale"}
              </button>
            )}
          </div>
        </div>
      )}

      {note && <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "#3fb950" }}>{note}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {flagged.map(round => (
          <div key={round.race_id}>
            <div style={{ fontSize: "0.86rem", fontWeight: 600 }}>{round.label}</div>
            {round.sessions.map(session => (
              <div key={session.session} style={{ marginTop: 4 }}>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  <strong style={{ color: "var(--ink-1)" }}>{session.session}</strong> · {scaleSummary(session.scale)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 3 }}>
                  {picker(choices[round.race_id]?.[session.session],
                    id => onChoose?.(round.race_id, session.session, id),
                    `${round.race_id}:${session.session}`)}
                  <button type="button" className="btn btn-ghost"
                    style={{ marginTop: 0, padding: "4px 10px", fontSize: "0.76rem" }} disabled={!!busy}
                    title="Save what SimRacerHub paid for this session as a points structure, and score this round on it"
                    onClick={async () => {
                      const id = await createFrom(session, `SimRacerHub · ${round.label || session.session}`);
                      if (id) onChoose?.(round.race_id, session.session, id);
                    }}>
                    ＋ Use SimRacerHub&rsquo;s scale
                  </button>
                </div>
              </div>
            ))}
            {/* A round SimRacerHub paid nothing for isn't a scale disagreement
                — it ran for no championship points, which this app says by
                scoring the session on nothing rather than by picking a scale. */}
            {round.unscored.map(session => (
              <div key={`u:${session.session}`} style={{ marginTop: 4 }}>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  <strong style={{ color: "var(--ink-1)" }}>{session.session}</strong> · {scaleSummary(session.scale)}
                </div>
                <div style={{ marginTop: 3 }}>
                  {picker(choices[round.race_id]?.[session.session],
                    id => onChoose?.(round.race_id, session.session, id),
                    `u:${round.race_id}:${session.session}`)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
