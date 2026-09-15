import { z } from "zod";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { ok, route } from "@/server/lib/http";
import { getTimeline } from "@/server/modules/workflow/engine";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND", "Pitch not found.");
  const events = await getTimeline(getDb(), session!.actor, id.data);
  return ok({ events: events.map((e) => ({
    seq: e.seq, action: e.action, fromStage: e.fromStageKey, toStage: e.toStageKey, actorId: e.actorId,
    fromOwnerId: e.fromOwnerId, toOwnerId: e.toOwnerId, remarks: e.remarks, recommendation: e.recommendation,
    rejectionCategory: e.rejectionCategoryKey, rejectionReason: e.rejectionReason, changeTypes: e.changeTypeKeys,
    approvalType: e.approvalType, platformId: e.platformId, at: e.createdAt,
  })) });
});
