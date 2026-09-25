"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { classTally, entryListSummary, entryListText } from "@/lib/entryList";

// A season's entry list, and the rows that open one. Three screens show it —
// a player's Dashboard, Series Sign-Ups for staff, and Driver Roster — and all
// of them open the same dialog, so the list reads the same wherever it's
// reached from. Who may read it is the API's call (see lib/entryList.js and
// /api/entry-list); these components only decide how it looks.

// One season's list, fetched. Who may read it is settled by the API, so a
// refusal arrives here as an error and is shown as one — the message is written
// for the player it's refusing (see ENTRY_LIST_CLOSED_MESSAGE).
export function EntryListView({ seasonId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api(`/api/entry-list?season_id=${encodeURIComponent(seasonId)}`)
      .then(res => { if (live) setData(res); })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [seasonId]);

  if (error) {
    return (
      <div className="empty-state" style={{ marginTop: 12 }}>
        <span className="empty-state-icon">📋</span>
        <p>{error}</p>
      </div>
    );
  }
  if (!data) return <div className="skeleton" style={{ height: 220, marginTop: 12 }} />;
  return <EntryListContent data={data} />;
}

// The list itself, from an /api/entry-list payload: confirmed entries in
// car-number order, then the sign-ups still waiting to get in. Split from the
// fetch so it can be rendered — and tested — from a payload alone.
export function EntryListContent({ data }) {
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(""), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  const { season, series, entries, pending, classes } = data;
  const title = [series?.name, season.name].filter(Boolean).join(" · ");
  const showClass = classes.length > 0;
  const showTeam = entries.some(e => e.team);
  const showCar = entries.some(e => e.cars.length) || pending.some(p => p.car);
  const tally = classTally(entries, classes);
  const logo = season.logo_url || series?.logo_url;

  // For pasting into Discord or a forum post — an entry list is usually
  // announced somewhere other than here.
  async function copy() {
    try {
      await navigator.clipboard.writeText(entryListText({ title, entries, pending }));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="entry-list">
      <div className="entry-list-head">
        {logo
          ? <img src={logo} alt="" className="avatar" style={{ borderRadius: 8 }} />
          : <span className="avatar avatar-fallback" style={{ borderRadius: 8 }} aria-hidden="true">🏁</span>}
        <div className="entry-list-title">
          <strong>{title}</strong>
          <span>
            {[data.game_name, entryListSummary({ entries, pending })].filter(Boolean).join(" · ")}
            {!data.open && " · Season over"}
          </span>
        </div>
        <button type="button" className="btn btn-ghost entry-list-copy" onClick={copy}
          disabled={!entries.length && !pending.length}
          title="Copy the entry list as plain text, one driver a line">
          {copied === "copied" ? "✓ Copied" : copied === "failed" ? "Copy failed" : "Copy as text"}
        </button>
      </div>

      {tally.length > 0 && (
        <div className="lockin-tally" style={{ marginTop: 10 }}>
          {tally.map(c => <span className="badge" key={c.name}>{c.name} · {c.count}</span>)}
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Driver</th>
              {showClass && <th>Class</th>}
              {showTeam && <th>Team</th>}
              {showCar && <th>Car</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map(row => (
              <tr key={row.entry_id} style={row.mine ? { background: "var(--accent-cyan-dim)" } : undefined}>
                <td>
                  <span className="badge">{String(row.number ?? "").trim() || "—"}</span>
                  {row.wants_number && (
                    <span className="roster-peek-pending" title="Number change waiting on an admin">
                      → #{row.wants_number}
                    </span>
                  )}
                </td>
                <td className="driver-name-cell">
                  {row.driver_id
                    ? <Link href={`/drivers/${row.driver_id}`} style={{ color: "var(--accent-cyan)" }}>{row.name}</Link>
                    : row.name}
                  {row.mine && <span className="entry-list-you">(you)</span>}
                </td>
                {showClass && <td>{row.class_names.join(" · ") || "—"}</td>}
                {showTeam && (
                  <td className="team-cell">
                    {row.team ? (
                      <span className="entry-list-team">
                        {row.team.logo_url && <img src={row.team.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />}
                        {row.team.name}
                      </span>
                    ) : "—"}
                  </td>
                )}
                {showCar && <td style={{ color: row.cars.length ? undefined : "var(--ink-2)" }}>{row.cars.join(" / ") || "—"}</td>}
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={2 + [showClass, showTeam, showCar].filter(Boolean).length} style={{ color: "var(--ink-2)" }}>
                  Nobody is on the roster yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Signed up, not seated. Listed apart from the field above so nobody
          reads a request as a place on the grid. */}
      {pending.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 20 }}>
            <h3>Signed up, not on the roster yet</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Driver</th>
                  {showClass && <th>Class</th>}
                  {showCar && <th>Car</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(row => (
                  <tr key={row.id} style={row.mine ? { background: "var(--accent-cyan-dim)" } : undefined}>
                    <td><span className="badge">{String(row.number ?? "").trim() || "—"}</span></td>
                    <td className="driver-name-cell">
                      {row.name}
                      {row.mine && <span className="entry-list-you">(you)</span>}
                    </td>
                    {showClass && <td>{row.class_names.join(" · ") || "—"}</td>}
                    {showCar && <td style={{ color: row.car ? undefined : "var(--ink-2)" }}>{row.car || "—"}</td>}
                    <td style={{ color: "var(--ink-1)", fontSize: "0.82rem" }}>
                      {row.awaiting_placement ? "⏱ Awaiting placement" : "⏳ Waiting on approval"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// The same list in a dialog, which is how every screen opens it.
export function EntryListModal({ seasonId, onClose }) {
  return (
    <Modal title="📋 Entry List" size="wide" onClose={onClose}>
      <EntryListView seasonId={seasonId} />
    </Modal>
  );
}

// One row per season, each opening its entry list. `meta` is what the right
// side of a row says — the player's own place on the Dashboard, head counts
// for staff.
export function EntryListRows({ seasons, sub, meta }) {
  const [openId, setOpenId] = useState("");
  return (
    <>
      <div className="list-rows" style={{ marginTop: 10 }}>
        {seasons.map(s => (
          <button type="button" key={s.season_id} className="list-row entry-list-row"
            onClick={() => setOpenId(s.season_id)}
            title={`Open the entry list for ${s.series_name} · ${s.season_name}`}>
            {s.logo_url
              ? <img src={s.logo_url} alt="" className="avatar" style={{ borderRadius: 6 }} />
              : <span className="avatar avatar-fallback" style={{ borderRadius: 6 }} aria-hidden="true">📋</span>}
            <span className="list-row-name">
              <strong>{s.series_name} · {s.season_name}</strong>
              <span>{sub(s)}</span>
            </span>
            {meta && <span className="list-row-meta">{meta(s)}</span>}
            <span className="entry-list-go">Entry list →</span>
          </button>
        ))}
      </div>
      {openId && <EntryListModal seasonId={openId} onClose={() => setOpenId("")} />}
    </>
  );
}

// Staff: every active season in the league, each one's entry list a click
// away. `gameId` narrows it to one game, for a screen already scoped to one.
export function ActiveEntryLists({ gameId = "", empty = null }) {
  // The list is league-scoped (api() stamps X-League-Id), so a league switch
  // has to re-ask rather than keep showing the last league's series.
  const { leagueId } = useLeague() || {};
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setSeasons(null);
    return api("/api/entry-list")
      .then(res => setSeasons(res.seasons || []))
      .catch(err => setError(err.message));
  }, [leagueId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <p className="field-error" style={{ marginTop: 8 }}>
        Couldn&rsquo;t load the entry lists: {error}{" "}
        <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "2px 10px" }} onClick={load}>
          Retry
        </button>
      </p>
    );
  }
  if (!seasons) return <div className="skeleton" style={{ height: 90, marginTop: 10 }} />;

  const shown = gameId ? seasons.filter(s => s.game_id === gameId) : seasons;
  if (!shown.length) return empty;

  return (
    <EntryListRows
      seasons={shown}
      sub={s => s.game_name || "—"}
      meta={s => (
        <>
          <span>
            <span className="list-row-meta-label">Entries</span>
            <span className="list-row-meta-value">{s.entry_count}</span>
          </span>
          <span>
            <span className="list-row-meta-label">Waiting</span>
            <span className="list-row-meta-value">{s.pending_count}</span>
          </span>
        </>
      )}
    />
  );
}
