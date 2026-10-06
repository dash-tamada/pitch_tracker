import { ok } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { listSendableCompanies } from "@/server/modules/public-creators/send";

export const GET = publicCreatorRoute({}, async ({ db }) => ok({ companies: await listSendableCompanies(db) }));
