import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { listPitchDocuments } from "@/server/modules/documents/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok({ documents: await listPitchDocuments(getDb(), session!.actor, uuidParam(params.id, "Pitch")) }));
