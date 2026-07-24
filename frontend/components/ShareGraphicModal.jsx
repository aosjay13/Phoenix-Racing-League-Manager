"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Social-media graphic exporter ───────────────────────────────────────────
// A reusable modal that renders a clean, self-styled graphic (its OWN DOM node,
// not a capture of the live page) and exports it as a downloadable PNG/JPG for
// posting to Discord / X / Facebook.
//
// Because the graphic is built from scratch with inline styles here, the export
// never picks up the app's sidebar, navbar, edit buttons, or any other UI
// clutter — only the headline the user types, the league's branding, an optional
// logo, and the data table are drawn. html2canvas is loaded lazily (dynamic
// import) so it stays out of the main bundle and only downloads when someone
// actually exports.
//
// Props:
//   open, onClose
//   kind          – short label used in the filename + default title ("Standings")
//   defaultTitle  – pre-filled headline (editable by the user)
//   subtitle      – muted meta line under the title (series · season · date …)
//   columns       – [{ key?, label, align?, locked? }]  (align: "left"|"center"|"right")
//                   locked columns can't be switched off in "Displayed Stats".
//   rows          – [{ cells: (string|number)[], rank? }]  cells.length === columns.length
//                   rank (1..3) tints the row's leading cell gold/silver/bronze.
//   logos         – [{ label, url }] logos the user can drop into the header.
//   leagueName    – pre-fills the League Name field (from League Settings)
//   leagueLogoUrl – pre-fills the League Logo picker (from League Settings)

const THEMES = {
  dark: {
    name: "Dark",
    pageBg: "#0b0b12",
    cardBg: "linear-gradient(160deg, #14141f 0%, #0d0d14 100%)",
    ink: "#eeeef5",
    muted: "#9090a8",
    faint: "#5a5a72",
    border: "rgba(255,255,255,0.09)",
    headBg: "rgba(0,180,216,0.12)",
    headInk: "#7fe3ff",
    stripe: "rgba(255,255,255,0.025)",
    accent: "#00b4d8",
  },
  light: {
    name: "Light",
    pageBg: "#e9ebf2",
    cardBg: "linear-gradient(160deg, #ffffff 0%, #f2f3f8 100%)",
    ink: "#15151f",
    muted: "#54546a",
    faint: "#8a8a9c",
    border: "rgba(0,0,0,0.10)",
    headBg: "rgba(0,150,185,0.12)",
    headInk: "#036d86",
    stripe: "rgba(0,0,0,0.025)",
    accent: "#0096b9",
  },
};

const MEDAL = { 1: "#f4a228", 2: "#c4cbd6", 3: "#cd8a54" };
const ROW_OPTIONS = [10, 15, 20, 30];

// Stable identity for a column, used as the key of its "Displayed Stats"
// checkbox and of the hidden-set. Falls back to the label + position for
// callers that pass hand-built column lists without a `key`.
const colKey = (c, i) => c.key ?? `${c.label}-${i}`;

export function ShareGraphicModal({
  open, onClose, kind = "Graphic", defaultTitle = "", subtitle = "",
  columns = [], rows = [], logos = [], leagueName = "", leagueLogoUrl = "",
}) {
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [theme, setTheme] = useState("dark");
  const [format, setFormat] = useState("png");
  const [logoIdx, setLogoIdx] = useState(-1);     // index into `logos`, or -1 = none
  const [uploadedLogo, setUploadedLogo] = useState(null); // data URL from a file upload
  const [league, setLeague] = useState(leagueName);
  const [leagueLogo, setLeagueLogo] = useState(leagueLogoUrl || "");
  const [uploadedLeagueLogo, setUploadedLeagueLogo] = useState(null);
  const [limit, setLimit] = useState(() => (rows.length > 15 ? 15 : rows.length || 15));
  // Column keys the user has switched OFF. Empty = every stat shown, which is
  // the default every time the modal opens.
  const [hidden, setHidden] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cardRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);
  // Re-seed the editable fields whenever the modal is (re)opened for new data.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setLimit(rows.length > 15 ? 15 : rows.length || 15);
      setUploadedLogo(null);
      setUploadedLeagueLogo(null);
      setLogoIdx(logos.length ? 0 : -1);
      setLeague(leagueName);
      setLeagueLogo(leagueLogoUrl || "");
      setHidden(new Set());     // smart default: all stat columns checked
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTitle, leagueName, leagueLogoUrl]);

  const activeLogo = uploadedLogo || (logoIdx >= 0 ? logos[logoIdx]?.url : null) || null;
  const activeLeagueLogo = uploadedLeagueLogo || leagueLogo || null;
  const t = THEMES[theme];

  // Drop every switched-off column from BOTH the header list and each row's
  // cells before the card renders — html2canvas captures the live node, so a
  // hidden column has to be gone from the DOM (not just visually collapsed) for
  // the remaining columns to expand into the space.
  const shownIdx = useMemo(
    () => columns.map((c, i) => i).filter(i => !hidden.has(colKey(columns[i], i))),
    [columns, hidden]
  );
  const shownColumns = useMemo(() => shownIdx.map(i => columns[i]), [shownIdx, columns]);
  const shownRows = useMemo(
    () => rows.slice(0, limit).map(r => ({ ...r, cells: shownIdx.map(i => r.cells[i]) })),
    [rows, limit, shownIdx]
  );

  if (!mounted || !open) return null;

  function toggleColumn(key) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function readFile(file, onDone) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onDone(reader.result);
    reader.readAsDataURL(file);
  }
  function onUpload(e) {
    readFile(e.target.files?.[0], url => { setUploadedLogo(url); setLogoIdx(-1); });
  }
  function onUploadLeagueLogo(e) {
    readFile(e.target.files?.[0], url => setUploadedLeagueLogo(url));
  }

  async function download() {
    if (!cardRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const node = cardRef.current;
      const canvas = await html2canvas(node, {
        backgroundColor: t.pageBg,
        scale: Math.max(2, Math.ceil(1080 / node.offsetWidth)), // ≥ ~1080px wide output
        useCORS: true,
        logging: false,
      });
      const mime = format === "jpg" ? "image/jpeg" : "image/png";
      const dataUrl = canvas.toDataURL(mime, 0.95);
      const safe = (title || kind).replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || kind;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${safe}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      // A tainted canvas (a logo served without CORS headers) is the usual
      // failure — surface a readable hint rather than a raw SecurityError.
      setError(/tainted|insecure|security/i.test(String(err?.message))
        ? "Couldn't render the selected logo (blocked by its host). Try uploading the logo file instead."
        : (err?.message || "Export failed."));
    } finally {
      setBusy(false);
    }
  }

  const control = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--ink-0)", fontSize: "0.85rem" };
  const fieldStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: "var(--ink-1)" };
  const toggleable = columns.filter(c => !c.locked);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.66)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="form-card" style={{ maxWidth: 1180, width: "100%", margin: "24px 0" }} onMouseDown={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>🖼 Share Graphic</h3>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} disabled={busy} onClick={onClose}>✕</button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: "0.84rem", color: "var(--ink-1)" }}>
          Customize the headline, branding, and which stats appear — then download a clean image ready for Discord, X, or Facebook.
        </p>

        {/* Customization controls */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
            Headline
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Round 4 Official Results" style={control} />
          </label>

          <label style={fieldStyle}>
            League name
            <input value={league} onChange={e => setLeague(e.target.value)} placeholder="e.g. Prodigy Racing Association" style={control} />
          </label>

          <label style={fieldStyle}>
            League logo
            <select value={uploadedLeagueLogo ? "upload" : leagueLogo} style={control}
              onChange={e => { const v = e.target.value; if (v === "upload") return; setUploadedLeagueLogo(null); setLeagueLogo(v); }}>
              <option value="">None</option>
              {leagueLogoUrl && <option value={leagueLogoUrl}>League Settings logo</option>}
              {logos.filter(l => l.url !== leagueLogoUrl).map((l, i) => <option key={i} value={l.url}>{l.label}</option>)}
              {uploadedLeagueLogo && <option value="upload">Uploaded image</option>}
            </select>
          </label>

          <label style={fieldStyle}>
            …or upload a league logo
            <input type="file" accept="image/*" onChange={onUploadLeagueLogo} style={{ ...control, padding: "6px 8px" }} />
          </label>

          <label style={fieldStyle}>
            Series logo
            <select value={uploadedLogo ? "upload" : String(logoIdx)} onChange={e => { const v = e.target.value; if (v === "upload") return; setUploadedLogo(null); setLogoIdx(Number(v)); }} style={control}>
              <option value="-1">None</option>
              {logos.map((l, i) => <option key={i} value={i}>{l.label}</option>)}
              {uploadedLogo && <option value="upload">Uploaded image</option>}
            </select>
          </label>

          <label style={fieldStyle}>
            …or upload a logo
            <input type="file" accept="image/*" onChange={onUpload} style={{ ...control, padding: "6px 8px" }} />
          </label>

          <label style={fieldStyle}>
            Theme
            <select value={theme} onChange={e => setTheme(e.target.value)} style={control}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>

          {rows.length > 10 && (
            <label style={fieldStyle}>
              Rows shown
              <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={control}>
                {ROW_OPTIONS.filter(n => n < rows.length).map(n => <option key={n} value={n}>Top {n}</option>)}
                <option value={rows.length}>All ({rows.length})</option>
              </select>
            </label>
          )}

          <label style={fieldStyle}>
            Format
            <select value={format} onChange={e => setFormat(e.target.value)} style={control}>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
          </label>
        </div>

        {/* Displayed Stats — uncheck a column to drop it from the graphic. */}
        {toggleable.length > 0 && (
          <div style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <strong style={{ fontSize: "0.85rem" }}>Displayed Stats</strong>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Uncheck a column to leave it out — the rest spread out to fill the space.
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "2px 10px", fontSize: "0.78rem" }}
                  onClick={() => setHidden(new Set())}>All</button>
                <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "2px 10px", fontSize: "0.78rem" }}
                  onClick={() => setHidden(new Set(columns.map((c, i) => (c.locked ? null : colKey(c, i))).filter(Boolean)))}>None</button>
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
              {columns.map((c, i) => {
                const key = colKey(c, i);
                const on = !hidden.has(key);
                return (
                  <label key={key} title={c.locked ? "Always shown" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: "0.82rem", color: c.locked ? "var(--ink-2)" : "var(--ink-1)", cursor: c.locked ? "default" : "pointer" }}>
                    <input type="checkbox" checked={on} disabled={c.locked} onChange={() => toggleColumn(key)}
                      style={{ width: 16, height: 16, accentColor: "var(--accent-cyan)" }} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Live preview — this exact node is what gets captured. */}
        <div style={{ background: t.pageBg, borderRadius: 12, padding: 16, overflowX: "auto", border: "1px solid var(--border)" }}>
          <GraphicCard cardRef={cardRef} theme={t} title={title || defaultTitle || kind} subtitle={subtitle}
            logo={activeLogo} leagueName={league} leagueLogo={activeLeagueLogo}
            columns={shownColumns} rows={shownRows} totalRows={rows.length} shownCount={shownRows.length} />
        </div>

        {error && <div className="toast toast-error" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn btn-primary" type="button" onClick={download} disabled={busy || !shownRows.length || !shownColumns.length}>
            {busy ? "Rendering…" : `⬇ Download ${format.toUpperCase()}`}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// The captured node. Fixed 1080px wide for a consistent, feed-friendly output.
// The league's name is the eyebrow above the headline; its logo anchors the
// footer, so league branding frames the graphic without fighting the headline or
// the series logo in the header.
function GraphicCard({ cardRef, theme: t, title, subtitle, logo, leagueName, leagueLogo, columns, rows, totalRows, shownCount }) {
  const league = (leagueName || "").trim();
  return (
    <div
      ref={cardRef}
      style={{
        width: 1080, boxSizing: "border-box", background: t.cardBg, color: t.ink,
        padding: "44px 48px 34px", fontFamily: '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif',
        borderRadius: 20, border: `1px solid ${t.border}`,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 22, borderBottom: `2px solid ${t.accent}`, paddingBottom: 20, marginBottom: 22 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {league && (
            <div style={{ fontSize: 13, letterSpacing: "0.22em", textTransform: "uppercase", color: t.accent, fontWeight: 700, marginBottom: 8 }}>
              {league}
            </div>
          )}
          <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.01em" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 19, color: t.muted, marginTop: 8, fontWeight: 500 }}>{subtitle}</div>}
        </div>
        {logo && (
          // crossOrigin lets html2canvas rasterize a remotely-hosted logo when
          // its host sends CORS headers (Firebase Storage URLs do).
          <img src={logo} alt="" crossOrigin="anonymous" style={{ height: 96, width: 96, objectFit: "contain", borderRadius: 12, flexShrink: 0 }} />
        )}
      </div>

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 20, tableLayout: "auto" }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key ?? i} style={{
                textAlign: c.align || (i === 0 ? "left" : "center"),
                background: t.headBg, color: t.headInk, fontWeight: 700, fontSize: 15,
                letterSpacing: "0.04em", textTransform: "uppercase",
                padding: "11px 12px", whiteSpace: "nowrap",
                borderTopLeftRadius: i === 0 ? 8 : 0, borderTopRightRadius: i === columns.length - 1 ? 8 : 0,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? t.stripe : "transparent" }}>
              {r.cells.map((cell, ci) => {
                const medal = ci === 0 && r.rank ? MEDAL[r.rank] : null;
                return (
                  <td key={columns[ci]?.key ?? ci} style={{
                    textAlign: columns[ci]?.align || (ci === 0 ? "left" : "center"),
                    padding: "10px 12px", borderBottom: `1px solid ${t.border}`,
                    fontWeight: ci === 0 ? 700 : 500,
                    color: medal || (ci === 0 ? t.ink : t.muted),
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                    maxWidth: ci === 0 ? 360 : undefined, overflow: "hidden", textOverflow: "ellipsis",
                  }}>{cell === null || cell === undefined || cell === "" ? "—" : cell}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Footer / watermark — league branding anchors the bottom edge. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 20, fontSize: 14, color: t.faint }}>
        <span>{totalRows > shownCount ? `Top ${shownCount} of ${totalRows}` : `${totalRows} shown`}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {leagueLogo && (
            <img src={leagueLogo} alt="" crossOrigin="anonymous"
              style={{ height: 34, width: 34, objectFit: "contain", borderRadius: 7, flexShrink: 0 }} />
          )}
          <span style={{ fontWeight: 600, color: league ? t.muted : t.faint }}>
            {league || "Phoenix Racing League Manager"}
          </span>
        </span>
      </div>
    </div>
  );
}
