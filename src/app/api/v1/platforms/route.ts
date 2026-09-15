import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { createPlatform, listPlatforms } from "@/server/modules/platforms/service";

export const GET = route({ auth: true }, async ({ req, session }) => ok({ platforms: await listPlatforms(getDb(), session!.actor, req.nextUrl.searchParams.get("all") === "1") }));
export const POST = route({ auth: true }, async ({ req, session, ctx }) => ok(await createPlatform(getDb(), session!.actor, await readJson(req), ctx), 201));
