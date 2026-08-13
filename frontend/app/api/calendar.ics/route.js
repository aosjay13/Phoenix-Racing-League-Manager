import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { buildIcsCalendar } from "@/lib/icsFeed";

export const dynamic = "force-dynamic";

// The league's racing as a subscribable calendar feed.
//
//   GET /api/calendar.ics                       every game in the league
//   GET /api/calendar.ics?game_id=…             one game
//   GET /api/calendar.ics?series_id=…           one series
//   GET /api/calendar.ics?season_id=…           one season
//   …&league_id=…                               which league (see below)
//
// Paste the URL into Google Calendar's "From URL", Apple Calendar's "New
// Calendar Subscription", or Outlook's "Subscribe from web" and it keeps itself
// up to date: add a round, move a date, publish session times, and every
// subscriber's calendar follows on its next refresh. Nothing is pushed and
// nothing is stored on the subscriber's side, which is what makes this
// different from a one-off export.
//
// PUBLIC AND UNAUTHENTICATED, deliberately: a calendar client cannot send an
// Authorization header, so a feed that needed one could not be subscribed to at
// all. It exposes exactly what the public Calendar and Schedule pages already
// show anybody who opens the site — event names, tracks, dates and the session
// times an admin chose to publish. No results, no drivers, no accounts, and no
// write path.
//
// The active league arrives as `league_id` here rather than as the X-League-Id
// header the app's own fetches use, for the same reason: subscribers can only
// give a URL. getRequestLeagueId already reads either.
//
// The scope narrows through the same chain the app does, most specific first —
// a season belongs to a series, which belongs to a game — so a URL copied from
// the Calendar page's Subscribe button reproduces exactly what that page shows.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = (searchParams.get("season_id") || "").trim();
  const seriesId = (searchParams.get("series_id") || "").trim();
  const gameId = (searchParams.get("game_id") || "").trim();
  const leagueId = getRequestLeagueId(request);

  const [gamesSnap, seriesSnap, seasonsSnap, racesSnap, leagueSnap] = await Promise.all([
    db().collection("games").get(),
    db().collection("series").get(),
    scopeByLeague(db().collection("seasons"), leagueId).get(),
    db().collection("races").get(),
    leagueId ? db().collection("leagues").doc(leagueId).get() : Promise.resolve(null),
  ]);

  const games = Object.fromEntries(gamesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const series = Object.fromEntries(seriesSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  const seasons = Object.fromEntries(seasonsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

  // Races join to their season, so an out-of-league race resolves to no
  // in-scope season and drops out here — the same rule /api/schedule's master
  // feed uses.
  const inScope = s => {
    if (!s) return false;
    if (seasonId) return s.id === seasonId;
    if (seriesId) return s.series_id === seriesId;
    if (gameId) return s.game_id === gameId;
    return true;
  };

  const races = [];
  for (const doc of racesSnap.docs) {
    const r = { id: doc.id, ...doc.data() };
    const season = seasons[r.season_id];
    if (!inScope(season)) continue;
    const ser = season.series_id ? series[season.series_id] : null;
    races.push({
      ...r,
      season_name: season.name || "",
      series_name: ser?.name || "",
      game_name: season.game_id ? (games[season.game_id]?.name || "") : "",
    });
  }

  // What the calendar calls itself in a subscriber's sidebar. It names the
  // narrowest scope that was asked for, so somebody subscribed to three of
  // these can tell them apart at a glance.
  const league = leagueSnap?.exists ? { id: leagueSnap.id, ...leagueSnap.data() } : null;
  const scopeName = seasonId ? (seasons[seasonId]?.name || "")
    : seriesId ? (series[seriesId]?.name || "")
      : gameId ? (games[gameId]?.name || "")
        : "";
  const leagueName = league?.name || "Racing League";
  const name = scopeName ? `${leagueName} — ${scopeName}` : `${leagueName} — Race Calendar`;

  const body = buildIcsCalendar(races, {
    name,
    description: scopeName
      ? `Every race in ${scopeName}. Subscribe and it updates itself.`
      : "Every race in the league. Subscribe and it updates itself.",
    baseUrl: siteOrigin(request),
  });

  return new Response(body, {
    headers: {
      // The type is what makes a browser hand the URL to a calendar app rather
      // than render it as text; `inline` keeps a click from downloading a file
      // nobody wanted.
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="race-calendar.ics"',
      // Calendar clients poll on their own schedule (Google is famously
      // unhurried about it). A short cache spares the database a read per
      // subscriber per poll without making a new round wait to appear.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

// Where this deployment lives, for the link back to each race's own page.
// Behind a proxy the forwarded headers are the honest answer; the request URL
// is the fallback for a direct hit.
function siteOrigin(request) {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) return `${proto || "https"}://${host}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
