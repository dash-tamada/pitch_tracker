import { z } from "zod";
import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { parseInput } from "@/server/lib/validation";
import { setCurrentVersion } from "@/server/modules/documents/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) => {
  const { versionId } = parseInput(z.object({ versionId: z.uuid() }).strict(), await readJson(req));
  return ok(await setCurrentVersion(getDb(), session!.actor, uuidParam(params.id, "Document"), versionId, ctx));
});
