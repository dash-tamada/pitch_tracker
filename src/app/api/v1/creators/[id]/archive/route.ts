import { z } from "zod";
import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { parseInput } from "@/server/lib/validation";
import { setCreatorArchived } from "@/server/modules/creators/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) => {
  const { archived } = parseInput(z.object({ archived: z.boolean() }).strict(), await readJson(req));
  return ok(await setCreatorArchived(getDb(), session!.actor, uuidParam(params.id, "Creator"), archived, ctx));
});
