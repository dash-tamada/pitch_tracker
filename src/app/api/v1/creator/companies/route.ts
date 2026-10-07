import { ok } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { listAcceptingHouses } from "@/server/modules/public-creators/studio";

export const GET = publicCreatorRoute({}, async ({ db }) => ok({ companies: await listAcceptingHouses(db) }));
