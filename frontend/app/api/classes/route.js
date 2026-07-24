import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";

const routes = makeCollectionRoutes(SPECS.classes);
export const GET = routes.GET;
export const POST = routes.POST;
