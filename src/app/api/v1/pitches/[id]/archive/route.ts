import { z } from "zod";
import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { parseInput } from "@/server/lib/validation";
import { setPitchArchived } from "@/server/modules/pitches/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) => {
  const { archived } = parseInput(z.object({ archived: z.boolean() }).strict(), await readJson(req));
  return ok(await setPitchArchived(getDb(), session!.actor, uuidParam(params.id, "Pitch"), archived, ctx));
});
