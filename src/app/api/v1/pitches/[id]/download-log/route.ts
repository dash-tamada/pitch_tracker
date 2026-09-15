import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { pitchDownloadLog } from "@/server/modules/documents/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok({ entries: await pitchDownloadLog(getDb(), session!.actor, uuidParam(params.id, "Pitch")) }));
