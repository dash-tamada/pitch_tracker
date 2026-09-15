import { getDb } from "@/server/db/client";
import { ok, queryObject, route } from "@/server/lib/http";
import { userDirectory } from "@/server/modules/users/directory";

export const GET = route({ auth: true }, async ({ req, session }) => ok({ users: await userDirectory(getDb(), session!.actor, queryObject(req)) }));
