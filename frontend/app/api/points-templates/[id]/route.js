import { makeDocRoutes, SPECS } from "@/lib/entityApi";

const routes = makeDocRoutes(SPECS.pointsTemplates);
export const PATCH = routes.PATCH;
export const DELETE = routes.DELETE;
