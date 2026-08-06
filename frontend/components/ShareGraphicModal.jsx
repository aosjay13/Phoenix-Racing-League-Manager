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
//   columns       – [{ key?, label, align?, locked?, off? }]  (align: "left"|"center"|"right")
//                   every column starts ticked in "Displayed Stats"; locked ones
//                   can't be switched off at all, and `off` ones start unticked.
//   rows          – [{ cells: (string|number)[], rank? }]  cells.length === columns.length
//                   rank (1..3) tints the row's leading cell gold/silver/bronze.
//   logos         – [{ label, url }] logos the user can drop into the header.
//   leagueName    – pre-fills the League Name field (from League Settings)
//   leagueLogoUrl – offered as "League Settings logo" in the League Logo picker.
//                   Both logo pickers start on None — a logo is opt-in.

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

// Every column a screen offers starts ticked — the graphic opens showing all
// of the data, and anything unwanted is one click away in "Displayed Stats".
// (The table scales its type down as columns are added, see tableScale.)
//
// The one exception is a column marked `off`: it is offered in the picker but
// starts unticked. That's for the detail columns a screen carries for
// completeness (the per-driver bonus ticks on a results table, say) which would
// otherwise squeeze an ordinary results graphic into a dozen extra hairlines
// nobody asked for. One click still puts any of them on.
function defaultHidden(columns = []) {
  return new Set(columns.map((c, i) => (c.off ? colKey(c, i) : null)).filter(Boolean));
}

// The graphic is a fixed 1080px wide, so the more columns are on, the less room
// each gets. Rather than letting a wide selection overflow (or wrap into a
// mess), the table's type and padding step down as columns are added — a
// five-column results graphic stays big and bold, and a fifteen-column stats
// dump still fits inside the frame.
function tableScale(n) {
  if (n <= 5) return { font: 21, head: 15, padY: 11, padX: 13, name: 360, wrapHead: false };
  if (n <= 7) return { font: 19, head: 14, padY: 10, padX: 11, name: 300, wrapHead: false };
  if (n <= 9) return { font: 17, head: 13, padY: 9, padX: 9, name: 250, wrapHead: false };
  if (n <= 12) return { font: 15, head: 12, padY: 8, padX: 7, name: 210, wrapHead: false };
  // Past a dozen columns nothing else will fit on one line: the headers wrap
  // ("AVG / FINISH") so the widest column stops setting the table's width, and
  // the name column gives up its slack. Verified against a 17-column standings
  // export — without this the last column runs past the card's right edge.
  if (n <= 15) return { font: 13, head: 11, padY: 7, padX: 5, name: 175, wrapHead: true };
  return { font: 12, head: 10, padY: 6, padX: 4, name: 150, wrapHead: true };
}

// The header button that opens the exporter. Every screen that can export one
// carries the same control in the same place, so it reads as one feature
// rather than a per-page affordance.
export function ShareGraphicButton({ onClick, title }) {
  return (
    <button
      className="btn btn-ghost"
      style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
      title={title || "Export this table as an image for Discord, X or Facebook"}
      onClick={onClick}
    >
      🖼 Share Graphic
    </button>
  );
}

export function ShareGraphicModal({
  open, onClose, kind = "Graphic", defaultTitle = "", subtitle = "",
  columns = [], rows = [], logos = [], leagueName = "", leagueLogoUrl = "",
  meta = [],
}) {
  // Identity of the current column set, so reopening the modal for a different
  // screen (or a different tab of the same screen) re-seeds the picker.
  const columnsKey = columns.map((c, i) => colKey(c, i)).join("|");
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [theme, setTheme] = useState("dark");
  const [format, setFormat] = useState("png");
  const [logoIdx, setLogoIdx] = useState(-1);     // index into `logos`, or -1 = none
  const [uploadedLogo, setUploadedLogo] = useState(null); // data URL from a file upload
  const [league, setLeague] = useState(leagueName);
  // Logos start off — a plain graphic is the common case, and both pickers
  // still offer the league/series/track logos (and an upload) a click away.
  const [leagueLogo, setLeagueLogo] = useState("");
  const [uploadedLeagueLogo, setUploadedLeagueLogo] = useState(null);
  const [limit, setLimit] = useState(() => (rows.length > 15 ? 15 : rows.length || 15));
  // Column keys the user has switched OFF. Seeded from the column list: the
  // graphic opens with every stat the screen offers already on it, bar any the
  // screen marked `off` (see defaultHidden).
  const [hidden, setHidden] = useState(() => defaultHidden(columns));
  const [pickerOpen, setPickerOpen] = useState(false);
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
      setLogoIdx(-1);
      setLeague(leagueName);
      setLeagueLogo("");
      setHidden(defaultHidden(columns));
      setPickerOpen(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTitle, leagueName, leagueLogoUrl, columnsKey]);

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

        {/* Displayed Stats — a multi-select of every column the underlying
            screen offers, so any of them can be put on the graphic. */}
        {toggleable.length > 0 && (
          <div style={{ marginBottom: 16, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.85rem" }}>Displayed Stats</strong>
              <button type="button" onClick={() => setPickerOpen(v => !v)}
                style={{ ...control, display: "flex", alignItems: "center", gap: 10, minWidth: 260, cursor: "pointer", textAlign: "left" }}>
                <span style={{ flex: 1 }}>
                  {shownColumns.length === columns.length
                    ? `All ${columns.length} columns`
                    : `${shownColumns.length} of ${columns.length} columns`}
                </span>
                <span style={{ color: "var(--ink-2)" }}>{pickerOpen ? "▲" : "▼"}</span>
              </button>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Pick any stat from this screen — the chosen columns spread out to fill the graphic.
              </span>
            </div>

            {pickerOpen && (
              <>
                {/* Click-away backdrop so the menu closes like a real dropdown. */}
                <div style={{ position: "fixed", inset: 0, zIndex: 1 }} onMouseDown={() => setPickerOpen(false)} />
                <div style={{
                  position: "absolute", zIndex: 2, marginTop: 6, width: "min(520px, 100%)",
                  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10,
                  boxShadow: "0 14px 38px rgba(0,0,0,0.45)", overflow: "hidden",
                }}>
                  <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                    <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "3px 12px", fontSize: "0.78rem" }}
                      onClick={() => setHidden(new Set())}>Select all</button>
                    <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "3px 12px", fontSize: "0.78rem" }}
                      onClick={() => setHidden(new Set(columns.map((c, i) => (c.locked ? null : colKey(c, i))).filter(Boolean)))}>Clear</button>
                    <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: "0.76rem", color: "var(--ink-2)" }}>
                      {shownColumns.length}/{columns.length}
                    </span>
                  </div>
                  <div style={{ maxHeight: 280, overflowY: "auto", padding: "6px 4px" }}>
                    {columns.map((c, i) => {
                      const key = colKey(c, i);
                      const on = !hidden.has(key);
                      return (
                        <label key={key} title={c.locked ? "Always shown — a row isn't readable without it" : undefined}
                          style={{
                            display: "flex", alignItems: "center", gap: 9, margin: 0, padding: "7px 12px",
                            fontSize: "0.85rem", borderRadius: 6,
                            color: c.locked ? "var(--ink-2)" : "var(--ink-0)",
                            cursor: c.locked ? "default" : "pointer",
                          }}>
                          <input type="checkbox" checked={on} disabled={c.locked} onChange={() => toggleColumn(key)}
                            style={{ width: 16, height: 16, accentColor: "var(--accent-cyan)" }} />
                          <span style={{ flex: 1 }}>{c.label}</span>
                          {c.locked && <span style={{ fontSize: "0.72rem", color: "var(--ink-2)" }}>always on</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Live preview — this exact node is what gets captured. */}
        <div style={{ background: t.pageBg, borderRadius: 12, padding: 16, overflowX: "auto", border: "1px solid var(--border)" }}>
          <GraphicCard cardRef={cardRef} theme={t} title={title || defaultTitle || kind} subtitle={subtitle}
            logo={activeLogo} leagueName={league} leagueLogo={activeLeagueLogo} meta={meta}
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
// A logo drawn at its native aspect ratio inside a fixed box.
//
// `objectFit: contain` would do this in the browser, but html2canvas ignores
// object-fit and paints the image to whatever width/height the element carries
// — so a wide (or tall) logo came out stretched to a square in the exported
// PNG. Instead we read the image's natural size on load and set explicit pixel
// dimensions that already match its ratio: the element's box IS the letterboxed
// size, so the browser and html2canvas agree and nothing is distorted.
//
// maxW/maxH bound the box; the logo is scaled down to fit inside both and is
// never scaled up past its natural size, keeping the small form factor the
// header and footer were designed around.
function FittedLogo({ src, maxW, maxH, radius }) {
  const [natural, setNatural] = useState(null);

  // Reset when the picked logo changes, so a new image never renders at the
  // previous one's dimensions for a frame.
  useEffect(() => { setNatural(null); }, [src]);

  // Bails out when the size is unchanged: the ref callback below re-runs on
  // every render, and returning a fresh object each time would loop forever.
  function measure(el) {
    if (!el?.complete || !el.naturalWidth) return;
    const w = el.naturalWidth, h = el.naturalHeight;
    setNatural(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }

  const fit = (() => {
    if (!natural || !natural.w || !natural.h) return { width: maxW, height: maxH };
    const scale = Math.min(maxW / natural.w, maxH / natural.h, 1);
    return { width: Math.round(natural.w * scale), height: Math.round(natural.h * scale) };
  })();

  return (
    // crossOrigin lets html2canvas rasterize a remotely-hosted logo when its
    // host sends CORS headers (Firebase Storage URLs do).
    <img
      src={src} alt="" crossOrigin="anonymous"
      // A cached image can finish loading before React attaches onLoad, so also
      // measure on mount when the element reports itself already complete.
      ref={measure}
      onLoad={e => measure(e.currentTarget)}
      style={{
        width: fit.width, height: fit.height, objectFit: "contain",
        borderRadius: radius, flexShrink: 0,
        // Until the natural size is known the box is the full square; keeping
        // it invisible avoids a one-frame stretched flash on slow loads.
        visibility: natural ? "visible" : "hidden",
      }}
    />
  );
}

// Exported so the layout can be rendered and screenshotted outside the app.
// The league's name is the eyebrow above the headline; its logo anchors the
// footer, so league branding frames the graphic without fighting the headline or
// the series logo in the header.
export function GraphicCard({ cardRef, theme: t, title, subtitle, logo, leagueName, leagueLogo, meta = [], columns, rows, totalRows, shownCount }) {
  const league = (leagueName || "").trim();
  const sz = tableScale(columns.length);
  const facts = meta.filter(m => m && m.value != null && String(m.value).trim() !== "");
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
        {/* Bounded by height so a wide banner logo can spread sideways (up to
            half the card) without ever growing taller than the square it used
            to occupy. */}
        {logo && <FittedLogo src={logo} maxW={280} maxH={96} radius={12} />}
      </div>

      {/* Event metadata — the context that makes a results graphic readable on
          its own: which race, at which track, on what date, in which series and
          class. Rendered as labelled facts under the headline so the image
          carries everything the results screen shows above the table. */}
      {facts.length > 0 && (
        <div style={{
          marginBottom: 22, padding: "18px 22px",
          background: t.headBg, borderRadius: 12, borderLeft: `4px solid ${t.accent}`,
        }}>
          {/* A padding-based grid rather than flex `gap` or CSS grid: both are
              patchily supported by html2canvas, and a ragged strip is exactly
              what stops this reading as a broadcast graphic. Thirds keep every
              label on a column, and a long value (a track with its layout)
              takes two of them rather than pushing the row out of line. */}
          <div style={{ display: "flex", flexWrap: "wrap", margin: -9 }}>
            {facts.map(m => (
              <div key={m.label} style={{ width: `${(m.wide ? 2 : 1) * 33.333}%`, padding: 9, boxSizing: "border-box", minWidth: 0 }}>
                <div style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: t.faint, fontWeight: 700, marginBottom: 4 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: t.ink, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table. Type and padding step down as more columns are switched on, so
          a wide selection stays inside the 1080px frame while a narrow one
          still fills it — see tableScale. */}
      <table style={{ width: "100%", maxWidth: "100%", borderCollapse: "collapse", fontSize: sz.font, tableLayout: "auto" }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key ?? i} style={{
                textAlign: c.align || (i === 0 ? "left" : "center"),
                background: t.headBg, color: t.headInk, fontWeight: 700, fontSize: sz.head,
                letterSpacing: "0.04em", textTransform: "uppercase",
                padding: `${sz.padY}px ${sz.padX}px`, whiteSpace: sz.wrapHead ? "normal" : "nowrap",
                lineHeight: 1.15,
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
                  // A column of prose (an event name, a track, "Pro: Ana ·
                  // Am: Bo") can be far wider than the numbers these tables
                  // usually hold, and the card is a fixed 1080px — left on one
                  // line it pushes the last columns out past the frame. `wrap`
                  // lets such a column break onto a second line inside a capped
                  // width instead. Numeric columns stay on one line as before.
                  const wrap = !!columns[ci]?.wrap;
                  return (
                  <td key={columns[ci]?.key ?? ci} style={{
                    textAlign: columns[ci]?.align || (ci === 0 ? "left" : "center"),
                    padding: `${sz.padY - 1}px ${sz.padX}px`, borderBottom: `1px solid ${t.border}`,
                    fontWeight: ci === 0 ? 700 : 500,
                    color: medal || (ci === 0 ? t.ink : t.muted),
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: wrap ? "normal" : "nowrap",
                    lineHeight: wrap ? 1.25 : undefined,
                    // overflowWrap (not wordBreak): breaks between words, and
                    // only ever mid-word for a single word too long to fit at
                    // all — so "Spa-Francorchamps" stays intact.
                    overflowWrap: wrap ? "break-word" : undefined,
                    maxWidth: wrap || ci === 0 ? sz.name : undefined, overflow: "hidden", textOverflow: "ellipsis",
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
          {leagueLogo && <FittedLogo src={leagueLogo} maxW={110} maxH={34} radius={7} />}
          <span style={{ fontWeight: 600, color: league ? t.muted : t.faint }}>
            {league || "Phoenix Racing League Manager"}
          </span>
        </span>
      </div>
    </div>
  );
}
