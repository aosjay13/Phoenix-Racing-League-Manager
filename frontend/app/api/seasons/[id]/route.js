import { makeDocRoutes, SPECS } from "@/lib/entityApi";

const routes = makeDocRoutes(SPECS.seasons);
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
