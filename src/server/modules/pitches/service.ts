import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import {
  creators, lookupValues, pitchCodeCounters, pitchParticipants, pitches, workflowDefinitions, workflowEvents,
} from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { clearanceAllows, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";

const key = z.string().trim().min(1).max(60);

export const createPitchSchema = z.object({
  title: z.string().trim().min(1).max(200),
  logline: z.string().trim().max(500).optional(),
  shortSynopsis: z.string().trim().max(5000).optional(),
  detailedSynopsis: z.string().trim().max(100000).optional(),
  genreKey: key.optional(),
  subGenreKey: key.optional(),
  formatKey: key,
  languageKey: key,
  episodeCount: z.number().int().min(1).max(1000).optional(),
  episodeDurationMin: z.number().int().min(1).max(600).optional(),
  budgetRangeKey: key.optional(),
  targetAudience: z.string().trim().max(200).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  confidentiality: z.enum(["STANDARD", "CONFIDENTIAL", "RESTRICTED"]).default("CONFIDENTIAL"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: z.string().trim().max(5000).optional(),
  creatorId: z.uuid(),
}).strict();

type LookupKind = "GENRE" | "SUB_GENRE" | "FORMAT" | "LANGUAGE" | "BUDGET_RANGE";

export async function createPitch(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "pitch.create");
  const input = createPitchSchema.parse(raw);

  if (!clearanceAllows(actor.clearance, input.confidentiality)) {
    throw new AppError("VALIDATION", "You cannot set a confidentiality level above your own clearance.", { confidentiality: "Too high" });
  }

  return db.transaction(async (tx) => {
    const checks: [LookupKind, string | undefined][] = [
      ["FORMAT", input.formatKey], ["LANGUAGE", input.languageKey], ["GENRE", input.genreKey],
      ["SUB_GENRE", input.subGenreKey], ["BUDGET_RANGE", input.budgetRangeKey],
    ];
    for (const [type, k] of checks) {
      if (!k) continue;
      const [hit] = await tx.select({ key: lookupValues.key }).from(lookupValues)
        .where(and(eq(lookupValues.type, type), eq(lookupValues.key, k), eq(lookupValues.active, true)));
      if (!hit) throw new AppError("VALIDATION", "Unknown option selected.", { [type.toLowerCase()]: "Invalid" });
    }
    const [creator] = await tx.select({ id: creators.id }).from(creators)
      .where(and(eq(creators.id, input.creatorId), isNull(creators.archivedAt)));
    if (!creator) throw new AppError("VALIDATION", "Creator not found.", { creatorId: "Invalid" });

    const [def] = await tx.select({ id: workflowDefinitions.id, initial: workflowDefinitions.initialStageKey })
      .from(workflowDefinitions).where(eq(workflowDefinitions.isActive, true));
    if (!def) throw new AppError("INTERNAL", "No active workflow is configured.");

    const year = new Date().getUTCFullYear();
    const [counter] = await tx.insert(pitchCodeCounters).values({ year, lastValue: 1 })
      .onConflictDoUpdate({ target: pitchCodeCounters.year, set: { lastValue: sql`${pitchCodeCounters.lastValue} + 1` } })
      .returning({ lastValue: pitchCodeCounters.lastValue });
    const pitchCode = `PT-${year}-${String(counter!.lastValue).padStart(6, "0")}`;

    const [pitch] = await tx.insert(pitches).values({
      ...input,
      logline: input.logline ?? null, shortSynopsis: input.shortSynopsis ?? null, detailedSynopsis: input.detailedSynopsis ?? null,
      pitchCode, createdById: actor.userId, workflowDefinitionId: def.id, currentStageKey: def.initial,
      currentOwnerId: actor.userId, lastEventSeq: 1,
    }).returning({ id: pitches.id, pitchCode: pitches.pitchCode, version: pitches.version });

    await tx.insert(workflowEvents).values({
      pitchId: pitch!.id, seq: 1, action: "SUBMIT", fromStageKey: null, toStageKey: def.initial,
      actorId: actor.userId, toOwnerId: actor.userId, remarks: "Story submitted",
    });
    await tx.insert(pitchParticipants).values({ pitchId: pitch!.id, userId: actor.userId, reason: "CREATED" });
    await writeAudit(tx, { actorId: actor.userId, action: "pitch.created", resourceType: "pitch", resourceId: pitch!.id,
      after: { pitchCode, title: input.title, creatorId: input.creatorId, confidentiality: input.confidentiality } }, ctx);
    return pitch!;
  });
}
