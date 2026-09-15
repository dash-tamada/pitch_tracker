import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { createUser, listUsers } from "@/server/modules/users/admin";

export const GET = route({ auth: true }, async ({ session }) => ok({ users: await listUsers(getDb(), session!.actor) }));
export const POST = route({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, session, ctx }) => ok(await createUser(getDb(), session!.actor, await readJson(req), ctx), 201));
