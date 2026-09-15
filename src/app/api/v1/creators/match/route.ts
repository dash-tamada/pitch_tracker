import { z } from "zod";
import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { parseInput } from "@/server/lib/validation";
import { findCreatorMatches } from "@/server/modules/creators/service";

const schema = z.object({ name: z.string().max(120).optional(), mobile: z.string().max(20).optional(), email: z.string().max(254).optional() }).strict();

// Tight limit: lookup by mobile/email must not become an enumeration tool.
export const POST = route({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, session }) =>
  ok({ matches: await findCreatorMatches(getDb(), session!.actor, parseInput(schema, await readJson(req))) }));
