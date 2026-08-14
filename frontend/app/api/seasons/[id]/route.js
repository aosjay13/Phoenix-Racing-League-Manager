import { makeDocRoutes, SPECS } from "@/lib/entityApi";
import { announceSeasonCompleted } from "@/lib/seasonCompletionServer";

// The generic doc routes, plus the one thing saving a SEASON has to do that
// saving a game or a series doesn't: when this PATCH is the one that marks the
// season complete, everybody who raced in it is told so on their message board.
//
// It hangs off the route rather than off League Setup's "Mark Completed" button
// because the status is an ordinary field on an ordinary PATCH — a rule that
// lives in one button is a rule with a hole in it. The hook only fires on the
// active → completed transition, so re-saving a finished season announces
// nothing (see lib/seasonCompletion.js).
const routes = makeDocRoutes({ ...SPECS.seasons, afterUpdate: announceSeasonCompleted });
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
