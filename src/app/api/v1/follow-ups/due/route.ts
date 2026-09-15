import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { dueFollowUps } from "@/server/modules/platforms/service";

export const GET = route({ auth: true }, async ({ req, session }) =>
  ok({ followUps: await dueFollowUps(getDb(), session!.actor, new Date(), req.nextUrl.searchParams.get("all") !== "1") }));
