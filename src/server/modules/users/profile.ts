import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { normalizeMobile } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import type { Actor } from "@/server/modules/authz/policy";

/** Empty string clears the number. Anything else must be a real mobile number (10 digits = India, or +country code). */
const whatsappSchema = z.object({ mobile: z.string().trim().max(24) }).strict();

/** A person sets or clears their own WhatsApp number. The caller's id comes from the session, never the request. */
export async function setOwnWhatsapp(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}): Promise<{ mobileE164: string | null }> {
  const { mobile } = parseInput(whatsappSchema, raw);
  const e164 = mobile === "" ? null : normalizeMobile(mobile);
  if (mobile !== "" && !e164) throw new AppError("VALIDATION", "Enter a valid WhatsApp number, e.g. 98765 43210 or +44 7700 900123.", { mobile: "Not a valid number" });
  const [before] = await db.select({ m: users.mobileE164 }).from(users).where(eq(users.id, actor.userId));
  await db.update(users).set({ mobileE164: e164 }).where(eq(users.id, actor.userId));
  await writeAudit(db, { actorId: actor.userId, action: "user.whatsapp_updated", resourceType: "user", resourceId: actor.userId,
    before: { mobileE164: before?.m ?? null }, after: { mobileE164: e164 } }, ctx);
  return { mobileE164: e164 };
}
