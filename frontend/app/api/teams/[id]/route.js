import { makeDocRoutes, SPECS } from "@/lib/entityApi";

const routes = makeDocRoutes(SPECS.teams);
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
