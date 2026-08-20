import { cachedPayload } from "@/lib/statsCache";
import { computeStats } from "@/lib/statsCompute/stats";
import { computeStandings } from "@/lib/statsCompute/standings";
import { computeTeamStats } from "@/lib/statsCompute/teamStats";
import { computeSkillRatings } from "@/lib/statsCompute/skillRatings";
import { computeGlobalSchedule, computeSeasonSchedule } from "@/lib/statsCompute/schedule";

// The one place that says what a "stats read" is.
//
// Every expensive league read is a named builder: a pure function of (league,
// params) returning a { status, body } envelope. The read routes serve them and
// the rebuild precomputes them, and because both go through this table neither
// can grow a case the other doesn't know about.
//
// This is what keeps precomputation honest. A stored answer is the output of
// the SAME function a live read would have called — not a second implementation
// of the scoring rules that could drift from the first. A precomputed number
// cannot disagree with a calculated one, because it IS one, kept.
export const BUILDERS = Object.freeze({
  "stats": computeStats,
  "standings": computeStandings,
  "team-stats": computeTeamStats,
  "skill-ratings": computeSkillRatings,
  "schedule:season": computeSeasonSchedule,
  "schedule:all": computeGlobalSchedule,
});

export function builderFor(name) {
  return BUILDERS[name] || null;
}

// The cached, stored-first readers the route handlers actually call. Wrapping
// happens here rather than in each route so the wrapper and the registry entry
// are written together and cannot name different things.
export const statsFor = cachedPayload("stats", computeStats);
export const standingsFor = cachedPayload("standings", computeStandings);
export const teamStatsFor = cachedPayload("team-stats", computeTeamStats);
export const skillRatingsFor = cachedPayload("skill-ratings", computeSkillRatings);
export const seasonSchedule = cachedPayload("schedule:season", computeSeasonSchedule);
export const globalSchedule = cachedPayload("schedule:all", computeGlobalSchedule);
