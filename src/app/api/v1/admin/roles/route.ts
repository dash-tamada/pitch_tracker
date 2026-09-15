import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { listRolesWithPermissions } from "@/server/modules/users/admin";

export const GET = route({ auth: true }, async ({ session }) => ok(await listRolesWithPermissions(getDb(), session!.actor)));
