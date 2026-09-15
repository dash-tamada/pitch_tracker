import { z } from "zod";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { ok, readJson, route } from "@/server/lib/http";
import { getAvailableActions, performAction } from "@/server/modules/workflow/engine";

const idSchema = z.uuid();
const pitchId = (id: string) => {
  const p = idSchema.safeParse(id);
  if (!p.success) throw new AppError("NOT_FOUND", "Pitch not found.");
  return p.data;
};

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok({ actions: await getAvailableActions(getDb(), session!.actor, pitchId(params.id)) }));

export const POST = route<{ id: string }>({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, params, ctx }) => {
  const result = await performAction(getDb(), session!.actor, pitchId(params.id), await readJson(req), ctx);
  return ok({ eventId: result.event.id, seq: result.event.seq, stage: result.event.toStageKey, version: result.version }, 201);
});
