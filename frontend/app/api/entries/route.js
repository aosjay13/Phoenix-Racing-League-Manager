import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";

const routes = makeCollectionRoutes(SPECS.entries);
export const GET = routes.GET;
export const POST = routes.POST;
