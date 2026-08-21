import { makeDocRoutes, SPECS } from "@/lib/entityApi";

const routes = makeDocRoutes(SPECS.tracks);

// A venue is an ordinary pool document: edited and deleted through the generic
// doc routes, and READ out of the raw bundle every screen already holds (the
// track pool travels with it — see lib/rawBundle.js), so there is no GET here.
//
// The historical stats that used to hang off a GET here — every race held at the
// venue, its record books, its leaderboard and its past winners — are computed
// in the browser now (see lib/trackCompute.js). Building them here meant walking
// every season that had ever raced at the track and re-reading each one whole,
// so opening a track page cost about what opening the all-time stats table did.
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
