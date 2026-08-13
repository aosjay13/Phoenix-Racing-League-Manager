// What a denied sign-up says — in the email that goes out, and on the notice
// waiting on the Sign-ups screen when the player comes back.
//
// Both are built from the same request document and the same words, because
// they are the same message delivered twice: an email a player may never open,
// and an in-app notice they cannot miss. The app is the source of truth (email
// may not even be configured — see lib/mailer.js); the email is the nudge.
//
// The one thing that has to survive intact is the ADMIN'S REASON. A denial with
// no reason is the thing players complain about, so where there is one it leads,
// and where there isn't the copy says plainly that none was given rather than
// leaving an empty space that reads like a bug.

// Escape anything that came from a human before it goes into the HTML half.
// The reason an admin types is free text and lands in a message body — it must
// not be able to carry markup into somebody's inbox.
//
// Defined here rather than imported from the mailer so this module stays pure:
// it's read by the Sign-ups screen in the browser as well as by the API, and
// pulling firebase-admin in behind it would be absurd.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "Formula Phoenix · Season 4"
function seasonLabel(req) {
  return [req?.series_name, req?.season_name].filter(Boolean).join(" · ") || "that season";
}

// The reason an admin typed, or null. Trimmed, because a box someone tabbed
// through leaves whitespace that would otherwise render as a reason.
export function denyReason(req) {
  const reason = String(req?.deny_reason ?? "").trim();
  return reason || null;
}

// The subject line. Names the series, so a player in three of them knows which
// one this is about without opening it.
export function denialSubject(req) {
  return `Your sign-up for ${seasonLabel(req)} wasn't approved`;
}

// The plain-text body. Written to be read on a phone lock screen: what
// happened, why, and what to do about it, in that order.
export function denialText(req, { signupUrl = "" } = {}) {
  const reason = denyReason(req);
  const lines = [
    `Hi ${req?.name || "there"},`,
    "",
    `Your sign-up for ${seasonLabel(req)} wasn't approved by the league admins.`,
    "",
    reason
      ? `The reason they gave: ${reason}`
      : "They didn't leave a reason. Ask an admin if you're not sure why.",
    "",
    "You can sign up again once that's sorted — nothing is held against you, and"
    + " your details are already saved, so it's a much shorter form the second time.",
  ];
  if (signupUrl) {
    lines.push("", `Sign up again: ${signupUrl}`);
  }
  return lines.join("\n");
}

// The HTML half. Deliberately plain — inbox clients mangle anything clever, and
// this needs to be legible more than it needs to be pretty. Every value that
// came from a human is escaped: the reason is free text an admin typed.
export function denialHtml(req, { signupUrl = "" } = {}) {
  const reason = denyReason(req);
  return [
    `<p>Hi ${escapeHtml(req?.name || "there")},</p>`,
    `<p>Your sign-up for <strong>${escapeHtml(seasonLabel(req))}</strong> wasn&rsquo;t approved by`
      + " the league admins.</p>",
    reason
      ? `<p><strong>The reason they gave:</strong><br>${escapeHtml(reason)}</p>`
      : "<p>They didn&rsquo;t leave a reason. Ask an admin if you&rsquo;re not sure why.</p>",
    "<p>You can sign up again once that&rsquo;s sorted — nothing is held against you, and your"
      + " details are already saved, so it&rsquo;s a much shorter form the second time.</p>",
    signupUrl
      ? `<p><a href="${escapeHtml(signupUrl)}">Sign up again</a></p>`
      : "",
  ].filter(Boolean).join("\n");
}

// The in-app notice. Same three beats as the email, as fields the screen can
// lay out itself.
export function denialNotice(req) {
  return {
    id: req?.id || "",
    season_id: req?.season_id || "",
    season_name: req?.season_name || "Season",
    series_id: req?.series_id || "",
    series_name: req?.series_name || "Series",
    game_id: req?.game_id || "",
    name: req?.name || "",
    number: String(req?.number ?? "").trim(),
    car: req?.car || "",
    reason: denyReason(req),
    denied_at: req?.resolved_at || "",
  };
}

// The denials this account hasn't read yet, newest first.
//
// `player_seen_at` is stamped when they acknowledge one. Until then it sits at
// the top of the Sign-ups screen and that season is held back from the join
// list — the point is that they read WHY before trying again, since trying
// again without fixing the reason just burns another round trip for everyone.
export function unreadDenials(rows = []) {
  return rows
    .filter(r => !r?.player_seen_at)
    .map(denialNotice)
    .sort((a, b) => String(b.denied_at).localeCompare(String(a.denied_at)));
}

// ── The other outcome ──────────────────────────────────────────────────────
//
// An approval used to be as quiet as a denial, and for a while it was answered
// here too — an unread `approved` row put a welcome banner on the Dashboard.
//
// That job has moved to the message board (lib/messages.js), which says the
// same thing for every admin decision rather than only for the two this module
// knows about, and which the player can answer. Approving a sign-up posts a
// `signup_approved` message; the banner it renders is the welcome.
//
// The denial half stays here because it does something the board doesn't: an
// unacknowledged denial HOLDS THAT SEASON BACK from the join list, so the
// reason gets read before the same form is filled in again.
