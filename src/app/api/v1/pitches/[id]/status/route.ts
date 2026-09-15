import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { getPitchDetail } from "@/server/modules/pitches/service";

/** "Where is this story now?" */
export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok((await getPitchDetail(getDb(), session!.actor, uuidParam(params.id, "Pitch"))).status));
