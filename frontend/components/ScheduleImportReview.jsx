"use client";

import { TRACK_TYPES } from "@/lib/trackTypes";
import { trackChoiceProblems } from "@/lib/scheduleReview";

// The review table a schedule import is approved from.
//
// Two importers produce a season's schedule — the SimRacerHub one and the
// pasted one — and an admin approves both the same way, because it is the same
// question: here are the rounds this would create, here is every venue they
// race at, and here is what would happen to each of them. A second copy of this
// would drift from the first, and the drift would be in the one screen standing
// between a paste and a season's worth of documents.
//
// It renders; it decides nothing. Which venue each name resolves to is
// `choices`, held by the importer that opened this, and whether those answers
// are complete is lib/scheduleReview.js — so the button that creates the season
// and the warnings under this table can never disagree about it.
//
// `sourceLabel` is what to call where this came from, since the one line of
// copy that differs between the two is whose naming a venue is learning.
const CREATE = "__create__";

// How a venue's standing reads, in the same words and colours the results
// importer uses for a driver's.
const TRACK_CHIP = {
  matched: { bg: "rgba(46,160,67,0.18)", fg: "#3fb950", label: "yours" },
  suggested: { bg: "rgba(210,153,34,0.18)", fg: "#d29922", label: "check" },
  new: { bg: "rgba(88,166,255,0.18)", fg: "#58a6ff", label: "new" },
};

// Why the matcher offered a candidate. "Same venue" is the one that matters:
// it is how an Oval is told from a Roval, which are one place and two tracks.
const CANDIDATE_WHY = {
  exact: "already raced under this name",
  layout: "same venue, different layout",
  close: "similar name",
};

export function ScheduleImportReview({ preview, choices, onChange, sourceLabel = "the source" }) {
  const rows = preview?.rows || [];
  const trackRows = preview?.tracks || [];
  const leagueTracks = preview?.league_tracks || [];
  const choiceFor = raw => choices[raw] || {};
  const { creating: creatingTracks, duplicateNames, unnamed, unanswered } =
    trackChoiceProblems(trackRows, choices);
  const setChoice = (raw, patch) => onChange(raw, patch);

  return (
    <>
          <h4 style={{ margin: "16px 0 6px" }}>The schedule</h4>
          <div style={{ overflowX: "auto", maxHeight: "56vh", overflowY: "auto" }}>
            <table className="stats-table" style={{ fontSize: "0.8rem", width: "100%" }}>
              <thead>
                <tr>
                  <th>R</th>
                  <th style={{ textAlign: "left" }}>Race</th>
                  <th>Date</th>
                  <th style={{ textAlign: "left" }}>Track</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const choice = r.track ? choiceFor(r.track) : null;
                  const willCreate = choice?.action === "create";
                  const named = willCreate
                    ? String(choice.name || "").trim()
                    : leagueTracks.find(t => t.id === choice?.track_id)?.name || "";
                  return (
                    <tr key={r.round_number} style={r.warnings.length ? { background: "rgba(210,153,34,0.08)" } : undefined}>
                      <td>{r.round_number}</td>
                      <td style={{ textAlign: "left" }}>
                        {r.name}
                        {r.points_count === false && (
                          <span title={`Runs for no championship points on ${sourceLabel}`} style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(255,255,255,0.08)", color: "var(--ink-2)" }}>
                            no points
                          </span>
                        )}
                      </td>
                      <td title={r.date_text || undefined}>{r.date || <em style={{ color: "var(--accent-amber, #d29922)" }}>—</em>}</td>
                      <td style={{ textAlign: "left" }} title={r.track && named !== r.track ? `${sourceLabel} calls it “${r.track}”` : undefined}>
                        {/* The venue as it will be HERE — the name settled in
                            the Venues table below, not the source's. */}
                        {named || r.track || <em style={{ color: "var(--ink-2)" }}>none</em>}
                        {r.track && willCreate && (
                          <span title="This venue will be added to your Tracks library" style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: "rgba(46,160,67,0.18)", color: "#3fb950" }}>
                            new
                          </span>
                        )}
                      </td>
                      <td title={r.length_text || undefined}>{r.length || <em style={{ color: "var(--ink-2)" }}>—</em>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── The venues ─────────────────────────────────────────────────
              The same check the results importer runs on driver names, on
              venue names: every layout this schedule races at, against the
              tracks this league already has. An exact hit needs nothing; a
              venue that merely RESEMBLES one is never taken as the same place
              without being asked, because "…Oval" and "…Roval" are one letter
              apart and two different tracks.

              And nothing here locks the league to the source's naming: a new
              venue is created under whatever name is typed in this table, and
              the source's own name is recorded on it, so next season's import
              matches it outright. */}
          {trackRows.length > 0 && (
            <>
              <h4 style={{ margin: "18px 0 6px" }}>
                Venues
                <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--ink-1)" }}>
                  {" "}· {preview.track_summary?.matched || 0} already yours,{" "}
                  {preview.track_summary?.suggested || 0} to check, {creatingTracks.length} new
                </span>
              </h4>
              <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)", maxWidth: 820 }}>
                Name a new venue whatever your league calls it — the name {sourceLabel} uses is remembered on it, so
                the next import of this series matches it without asking. A venue you point at one you already have
                keeps its lap records and history.
              </p>
              <div style={{ overflowX: "auto", maxHeight: "56vh", overflowY: "auto" }}>
                <table className="stats-table" style={{ fontSize: "0.8rem", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>{`On ${sourceLabel}`}</th>
                      <th style={{ textAlign: "left" }}>In your app</th>
                      <th style={{ textAlign: "left" }}>Called</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackRows.map(t => {
                      const choice = choiceFor(t.raw);
                      const creatingThis = choice.action === "create";
                      const chip = TRACK_CHIP[creatingThis ? "new" : t.status] || TRACK_CHIP.new;
                      const dupe = creatingThis
                        && duplicateNames.has(String(choice.name || "").trim().toLowerCase());
                      return (
                        <tr key={t.raw} style={dupe ? { background: "rgba(248,81,73,0.08)" } : undefined}>
                          <td style={{ textAlign: "left" }}>
                            {t.raw}
                            <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: chip.bg, color: chip.fg }}>
                              {chip.label}
                            </span>
                            {t.base && t.config && (
                              <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-2)" }}>
                                {t.base} · {t.config}
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: "left" }}>
                            <select
                              value={creatingThis ? CREATE : (choice.track_id || CREATE)}
                              aria-label={`Which track is ${t.raw}?`}
                              onChange={e => setChoice(t.raw, e.target.value === CREATE
                                ? { action: "create", name: choice.name || t.suggested_name, track_type: choice.track_type ?? t.suggested_type }
                                : { action: "use", track_id: e.target.value })}
                              style={{ minWidth: 200 }}
                            >
                              <option value={CREATE}>+ Add as a new track</option>
                              {/* The matcher's own offers first, each saying why
                                  it's here, then every other track in the league. */}
                              {t.candidates.length > 0 && (
                                <optgroup label="Best matches">
                                  {t.candidates.map(c => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}{CANDIDATE_WHY[c.reason] ? ` — ${CANDIDATE_WHY[c.reason]}` : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="Every track">
                                {leagueTracks.map(lt => (
                                  <option key={lt.id} value={lt.id}>{lt.name}</option>
                                ))}
                              </optgroup>
                            </select>
                          </td>
                          <td style={{ textAlign: "left" }}>
                            {creatingThis ? (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                <input
                                  value={choice.name ?? t.suggested_name}
                                  aria-label={`Name for ${t.raw}`}
                                  onChange={e => setChoice(t.raw, { name: e.target.value })}
                                  placeholder={t.suggested_name}
                                  style={{ minWidth: 170, padding: "4px 8px" }}
                                />
                                <select
                                  value={choice.track_type ?? t.suggested_type}
                                  aria-label={`Track type for ${t.raw}`}
                                  onChange={e => setChoice(t.raw, { track_type: e.target.value })}
                                  style={{ minWidth: 130 }}
                                >
                                  <option value="">Type (optional)</option>
                                  {TRACK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                                {t.logo_url && (
                                  <img src={t.logo_url} alt="" title="iRacing's own logo for this venue, saved with it"
                                    style={{ height: 22, maxWidth: 70, objectFit: "contain" }} />
                                )}
                              </div>
                            ) : (
                              <span style={{ color: "var(--ink-2)" }}>
                                {leagueTracks.find(lt => lt.id === choice.track_id)?.name || "— pick a track —"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {duplicateNames.size > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                  ⚠ Two venues would be created under the same name — give one a different name, or point it at the
                  track you already have.
                </p>
              )}
              {unnamed && (
                <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                  ⚠ A new venue needs a name.
                </p>
              )}
              {unanswered.length > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#f85149" }}>
                  ⚠ Pick a track for {unanswered.map(t => t.raw).join(", ")}, or add it as a new one.
                </p>
              )}
              {creatingTracks.some(t => t.logo_url) && (
                <p style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
                  New venues are saved with the source&rsquo;s own logo for them where there is one, and with the
                  surface their name implies. Location and length are yours to fill in on the Tracks screen —
                  neither is published.
                </p>
              )}
            </>
          )}
    </>
  );
}
