import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { creators } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { maskEmail, maskMobile, normalizeEmail, normalizeMobile, normalizeName } from "@/server/lib/pii";
import { can, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";

const httpsUrl = z.url({ protocol: /^https?$/ }).max(500);

export const createCreatorSchema = z.object({
  creatorType: z.enum(["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER", "CREATOR", "OTHER"]),
  fullName: z.string().trim().min(2).max(120),
  mobile: z.string().trim().max(20).optional(),
  email: z.email().max(254).optional(),
  location: z.string().trim().max(120).optional(),
  languageKeys: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  yearsExperience: z.number().int().min(0).max(80).optional(),
  bio: z.string().trim().max(5000).optional(),
  agency: z.string().trim().max(160).optional(),
  website: httpsUrl.optional(),
  socialLinks: z.array(z.object({ label: z.string().trim().max(40), url: httpsUrl }).strict()).max(10).default([]),
  notes: z.string().trim().max(5000).optional(),
  consentBasis: z.string().trim().max(60).optional(),
}).strict();

/** Duplicate check before creating: exact mobile/email match, fuzzy name match. Respects PII permission. */
export async function findCreatorMatches(db: Db, actor: Actor, q: { name?: string; mobile?: string; email?: string }) {
  requirePermission(actor, "creator.view");
  const conds = [];
  const mobile = q.mobile ? normalizeMobile(q.mobile) : null;
  if (mobile) conds.push(eq(creators.mobileE164, mobile));
  if (q.email) conds.push(eq(creators.emailNormalized, normalizeEmail(q.email)));
  if (q.name && q.name.trim().length >= 3) conds.push(sql`${creators.nameNormalized} % ${normalizeName(q.name)}`);
  if (conds.length === 0) return [];
  const rows = await db.select({ id: creators.id, fullName: creators.fullName, creatorType: creators.creatorType,
    mobileE164: creators.mobileE164, emailNormalized: creators.emailNormalized, location: creators.location })
    .from(creators).where(and(isNull(creators.archivedAt), or(...conds))).limit(10);
  const pii = can(actor, "creator.view_pii");
  return rows.map((r) => ({ ...r, mobileE164: pii ? r.mobileE164 : maskMobile(r.mobileE164),
    emailNormalized: pii ? r.emailNormalized : maskEmail(r.emailNormalized) }));
}

export async function createCreator(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "creator.create");
  const input = createCreatorSchema.parse(raw);
  const mobileE164 = input.mobile ? normalizeMobile(input.mobile) : null;
  if (input.mobile && !mobileE164) throw new AppError("VALIDATION", "Mobile number is not valid.", { mobile: "Invalid" });
  const emailNormalized = input.email ? normalizeEmail(input.email) : null;

  return db.transaction(async (tx) => {
    const dupConds = [
      ...(mobileE164 ? [eq(creators.mobileE164, mobileE164)] : []),
      ...(emailNormalized ? [eq(creators.emailNormalized, emailNormalized)] : []),
    ];
    if (dupConds.length) {
      const [dup] = await tx.select({ id: creators.id }).from(creators).where(or(...dupConds)).limit(1);
      if (dup) throw new AppError("CONFLICT", "A creator with this mobile number or email already exists. Use the existing profile.");
    }
    const [row] = await tx.insert(creators).values({
      creatorType: input.creatorType, fullName: input.fullName, nameNormalized: normalizeName(input.fullName),
      mobileE164, emailNormalized, location: input.location ?? null, languageKeys: input.languageKeys,
      yearsExperience: input.yearsExperience ?? null, bio: input.bio ?? null, agency: input.agency ?? null,
      website: input.website ?? null, socialLinks: input.socialLinks, notes: input.notes ?? null,
      consentBasis: input.consentBasis ?? null, consentRecordedAt: input.consentBasis ? new Date() : null,
      createdById: actor.userId,
    }).returning({ id: creators.id });
    await writeAudit(tx, { actorId: actor.userId, action: "creator.created", resourceType: "creator", resourceId: row!.id,
      after: { fullName: input.fullName, creatorType: input.creatorType } }, ctx);
    return row!;
  });
}
