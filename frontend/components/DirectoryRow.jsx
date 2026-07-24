"use client";

import Link from "next/link";

// One row in a directory listing (Drivers, Teams, Tracks). Centralising the
// markup here means the shared `.list-row` look — padding, hover, avatar,
// name block, right-aligned meta cells — only has to change in one place to
// update all three directories at once.
//
// Props:
//   href    — where the row links to
//   avatar  — { url?, fallback?, square? } (square = 6px radius, for logos)
//   title   — bold primary line
//   subtitle— muted secondary line
//   meta    — [{ label, value }] right-aligned stat cells (hidden on mobile)
//   linked  — adds the gold "linked account" emphasis (Drivers directory)
//   actions — optional node (e.g. admin Edit/Delete buttons) rendered as a
//             sibling *outside* the link so clicking it never navigates the row.
export function DirectoryRow({ href, avatar = {}, title, subtitle, meta = [], linked = false, actions = null, actionsWide = false }) {
  const link = (
    <Link href={href} className={`list-row${linked ? " linked" : ""}`}>
      {avatar.url
        ? <img src={avatar.url} alt="" className="avatar" style={avatar.square ? { borderRadius: 6 } : undefined} />
        : <span className="avatar avatar-fallback" style={avatar.square ? { borderRadius: 6, ...(avatar.bg ? { background: avatar.bg } : {}) } : (avatar.bg ? { background: avatar.bg } : undefined)}>
            {avatar.fallback ?? String(title || "?")[0]?.toUpperCase()}
          </span>}
      <span className="list-row-name">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </span>
      {meta.length > 0 && (
        <span className="list-row-meta">
          {meta.map((m, i) => (
            <span key={i}>
              <span className="list-row-meta-label">{m.label}</span>
              <span className="list-row-meta-value">{m.value}</span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );

  if (!actions) return link;
  return (
    <div className={`list-row-wrap${actionsWide ? " wide" : ""}`}>
      {link}
      <div className="list-row-actions">{actions}</div>
    </div>
  );
}
