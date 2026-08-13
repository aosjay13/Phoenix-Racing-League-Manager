// Everything the Sign-ups screen (app/signups) and its sidebar badge work out
// from ONE /api/users/me/series payload, kept pure — no React, no fetching — so
// the page, the badge and the tests all read exactly one set of rules.
//
// The screen this feeds is written for a player who has never used the app
// before: it says what joining a series involves before asking for anything,
// then walks them through it one step at a time. That means the helpers here
// answer questions in a player's words ("what will this ask me for?", "where
// has my sign-up got to?") rather than exposing the requirement chain, which
// lives in lib/carSelection.js and lib/signupRequest.js and is resolved for us
// by the API before it ever reaches here.

import { isNumberChange } from "@/lib/signupQueue";
import { requiredAliases } from "@/lib/signupRequest";
import { badgeSeasons, normalizePrefs, partitionJoinable } from "@/lib/signupPrefs";

// The whole process, in three steps, in plain language. Shown at the top of the
// screen with the current one highlighted, so nobody has to guess how much is
// left or what happens after they press the button.
export const JOIN_STEPS = [
  {
    step: 1,
    title: "Pick a series",
    blurb: "Choose the one you want to race from the list below.",
  },
  {
    step: 2,
    title: "Fill in the short form",
    blurb: "Your racing name, your car, and how the league reaches you.",
  },
  {
    step: 3,
    title: "An admin approves you",
    blurb: "Once they do, you're on the official roster and ready to race.",
  },
];

// "Formula Phoenix · Season 4" — how a season is named everywhere on the
// screen, so the card, the form header and the confirmation all agree.
export function seasonLabel(season) {
  if (!season) return "";
  return [season.series_name, season.season_name].filter(Boolean).join(" · ");
}

// The season rows a driver can actually join right now: open, and not already
// waiting on an admin. `my_pending` is set by the API for a sign-up this
// account has already sent.
//
// Deliberately UNFILTERED by what the player has said about each one — a season
// they've marked "not interested" is still joinable the moment they change
// their mind, and the screen needs to be able to find it to put it back. Which
// of these are shown, and which still count on the badge, is decided by
// lib/signupPrefs.js on top of this list.
export function joinableSeasons(data) {
  return (data?.open_signups || []).filter(s => !s.my_pending);
}

// What the player has said about each season they could join. Stored on their
// own account and returned with the payload.
export function signupPrefs(data) {
  return normalizePrefs(data?.signup_prefs);
}

// Sign-ups this account has sent that nobody has ruled on yet.
export function awaitingSeasons(data) {
  return (data?.open_signups || []).filter(s => s.my_pending);
}

// Seasons they're ON the roster of that still want a car chosen. This is the
// one genuinely outstanding job a signed-up driver can have, so it's what the
// screen puts first and what the sidebar badge counts alongside invitations.
export function seasonsNeedingCar(data) {
  return (data?.my_seasons || []).filter(s => s.open && s.needs_pick);
}

// One object holding every list the screen renders, so the page asks once and
// never re-derives a count in two places.
export function signupOverview(data) {
  const all = joinableSeasons(data);
  const prefs = signupPrefs(data);
  const { shown, notInterested } = partitionJoinable(all, prefs);
  const waiting = awaitingSeasons(data);
  const carsToPick = seasonsNeedingCar(data);
  return {
    // Everything open to them, including the ones they've put aside — the
    // screen needs the whole list to reopen one.
    allJoinable: all,
    // What the list on screen shows: everything except "not interested".
    joinable: shown,
    // Put aside, findable, joinable the moment they change their mind.
    notInterested,
    prefs,
    waiting,
    carsToPick,
    racing: data?.my_seasons || [],
    // No driver profile yet. Not a blocker — signing up IS how a new player
    // asks for one — but it changes what the screen says.
    needsDriver: !data?.driver,
    pendingClaim: data?.pending_claim || null,
    closed: Number(data?.closed_signups) || 0,
  };
}

// The number on the sidebar's Sign-ups badge: things that are waiting on the
// PLAYER — a series they could join, or a car they still have to choose.
// Sign-ups already sent are deliberately not counted: those are waiting on an
// admin, and a badge that never falls until somebody else acts is nagging
// rather than useful.
//
// Neither is a series the player has answered. A league running six series
// otherwise means a permanent red 6 for somebody who races one of them, and a
// number that never reaches zero is a number people stop reading — at which
// point the badge no longer works for the sign-up they DO want. Both "Clear
// Notification" and "Not Interested" take a season off this count; only the
// second also takes it off the list. Cars still to choose always count: that's
// a season they have already joined, and a genuinely outstanding job.
export function signupBadgeCount(data) {
  if (!data) return 0;
  return badgeSeasons(joinableSeasons(data), signupPrefs(data)).length
    + seasonsNeedingCar(data).length;
}

// The badge's tooltip, in the same plain language as the screen.
export function signupBadgeTitle(data) {
  if (!data) return "Sign up for a series";
  const joinable = badgeSeasons(joinableSeasons(data), signupPrefs(data)).length;
  const cars = seasonsNeedingCar(data).length;
  const parts = [];
  if (joinable) parts.push(`${joinable} series you can join`);
  if (cars) parts.push(`${cars} car${cars === 1 ? "" : "s"} to choose`);
  if (!parts.length) return "Nothing waiting on you right now";
  return parts.join(" · ");
}

// Everyone already on the roster or in the queue for a season — what a join
// card shows so a series doesn't look empty (or full) when it isn't. Number
// changes are somebody already racing, not another person joining, so they're
// left out of the "waiting" tally.
export function seasonCounts(season) {
  const racing = (season?.roster || []).length;
  const waiting = (season?.pending || []).filter(p => !isNumberChange(p)).length;
  return { racing, waiting };
}

// A class can ask for more than its season does (a number, or a car), which the
// form only reveals once that class is picked. Worth saying up front rather
// than letting a new question appear out of nowhere mid-form.
export function classesAskMore(season) {
  const base = season?.rules || {};
  return Object.values(season?.class_rules || {}).some(r =>
    (r.require_number && !base.require_number)
    || (r.require_car && !base.require_car)
    || ((r.car_options || []).length && !(base.car_options || []).length));
}

// The short badges under a season's name on its join card — enough to tell two
// series apart at a glance without opening either.
export function seasonChips(season) {
  const rules = season?.rules || {};
  const { racing, waiting } = seasonCounts(season);
  const chips = [];
  if (season?.game_name) chips.push(season.game_name);
  // "0 racing" reads like a fault. A season nobody has joined yet is an
  // invitation, so it says so.
  chips.push(racing ? `${racing} racing` : "Be the first to join");
  if (waiting) chips.push(`${waiting} waiting to get in`);
  if (rules.require_number) chips.push("Car number needed");
  if ((rules.car_options || []).length) {
    chips.push(rules.require_car ? "Choose your car" : "Car choice optional");
  }
  if (season?.classes?.length) {
    chips.push(`${season.classes.length} class${season.classes.length === 1 ? "" : "es"}`);
  }
  return chips;
}

// "Here's what the form will ask you for" — printed BEFORE the form, so
// somebody who doesn't have their iRacing customer ID to hand finds that out
// now rather than four fields in.
//
// It's built from the same two sources the form renders itself from: the
// season's resolved rules, and the platform identities the parent game
// requires. Anything already saved on the driver profile is filled in by the
// form itself, so this is the worst case, not a homework list.
export function signupNeeds(season) {
  const rules = season?.rules || {};
  const needs = [{
    key: "name",
    label: "The name you race under",
    detail: "How you'll show up in results and on the roster.",
  }];

  const aliases = requiredAliases({
    name: season?.game_name || "",
    ...(season?.game_requirements || {}),
  });
  for (const a of aliases) {
    needs.push({ key: `alias:${a.label}`, label: a.label, detail: a.why });
  }

  if (rules.require_number) {
    needs.push({
      key: "number",
      label: "A car number",
      detail: "The form lists the numbers already taken, and won't let you pick one of those.",
    });
  }

  const cars = rules.car_options || [];
  if (cars.length) {
    needs.push({
      key: "car",
      label: rules.require_car ? "The car you'll race" : "A car, if you want to choose one now",
      detail: `${cars.length} to pick from — one tap each.`,
    });
  }

  if (season?.classes?.length) {
    needs.push({
      key: "class",
      label: "Which class you're racing",
      detail: classesAskMore(season)
        ? "You can decide later. Some classes ask for a bit more when you pick them."
        : "You can decide later if you're not sure.",
    });
  }

  return needs;
}

// WHY there is nothing to join, in the player's own terms.
//
// An empty list has to say which of four different things has happened, or it
// reads as a page that failed to load. Getting this wrong is worse than saying
// nothing: a driver who has just sent a sign-up and is told "every season has
// been marked finished" will reasonably conclude their sign-up went nowhere.
// The reasons are checked most-recent-action first, because that's the one the
// player is asking about.
export function nothingToJoinReason(overview) {
  const o = overview || {};
  const waiting = o.waiting?.length || 0;
  const racing = o.racing?.length || 0;
  const closed = o.closed || 0;
  const aside = o.notInterested?.length || 0;
  const newSeason = "A new season will show up here the moment an admin opens one.";

  // Checked first: a list emptied by the player's own choices must say so, or
  // they're told the league has nothing running when it plainly does.
  if (aside) {
    return `${aside === 1 ? "The one season that's open is" : `All ${aside} open seasons are`} in`
      + " your “not interested” list below — open it to join one after all. " + newSeason;
  }
  if (waiting) {
    return racing
      ? `Your sign-up${waiting === 1 ? " above is" : "s above are"} with the admins, and you're already on every other season that's running. ${newSeason}`
      : `Your sign-up${waiting === 1 ? " above is" : "s above are"} with the admins — that's everything that was open. ${newSeason}`;
  }
  if (racing) {
    return `You're already signed up for everything that's running. ${newSeason}`;
  }
  if (closed) {
    return `${closed === 1 ? "The one other season has" : `All ${closed} other seasons have`} been marked finished, so those sign-ups are closed. ${newSeason}`;
  }
  return `There are no seasons open at the moment. ${newSeason}`;
}

// The headline above that reason.
export function nothingToJoinHeadline(overview) {
  const o = overview || {};
  if (o.notInterested?.length) return "Nothing left in your list.";
  return (o.waiting?.length || o.racing?.length)
    ? "Nothing else open to join right now."
    : "There's nothing open to join at the moment.";
}

// What a driver's own season row is waiting on, in one line they can act on.
// `tone` picks the colour the row is drawn in: "todo" is something for them to
// do, "ok" is settled.
export function seasonStatus(season) {
  if (!season?.open) return { tone: "ok", text: "Season over — nothing left to do." };
  if (season.needs_pick) {
    return { tone: "todo", text: "Choose the car you'll race — that's all that's left." };
  }
  if (!season.requires_car) {
    return { tone: "ok", text: "You're on the roster. This series doesn't ask you to pick a car." };
  }
  const cars = (season.picks || []).map(p => p.car).filter(Boolean);
  return {
    tone: "ok",
    text: cars.length ? `You're racing the ${cars.join(" · ")}.` : "You're on the roster.",
  };
}
