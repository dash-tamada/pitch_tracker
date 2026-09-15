import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/server/db/client";
import { systemSettings } from "@/server/db/schema";

/** Typed, validated system settings with safe defaults. */
export const settingsSchema = z.object({
  allow_self_approval: z.boolean().default(false),
  executive_approval_mode: z.enum(["ANY", "ALL"]).default("ANY"),
  ratings_visibility: z.enum(["ALL_EMPLOYEES", "MANAGEMENT"]).default("MANAGEMENT"),
  aging_thresholds_days: z.object({ attention: z.number().int().min(1), overdue: z.number().int().min(1), critical: z.number().int().min(1) })
    .default({ attention: 3, overdue: 7, critical: 14 }),
});
export type Settings = z.infer<typeof settingsSchema>;

export async function getSettings(db: DbOrTx): Promise<Settings> {
  const keys = Object.keys(settingsSchema.shape);
  const rows = await db.select().from(systemSettings).where(inArray(systemSettings.key, keys));
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = r.value;
  return settingsSchema.parse(raw);
}
