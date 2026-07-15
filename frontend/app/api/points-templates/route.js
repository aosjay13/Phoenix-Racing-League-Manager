import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";

const routes = makeCollectionRoutes(SPECS.pointsTemplates);
export const GET = routes.GET;
export const POST = routes.POST;
export const dynamic = "force-dynamic";
