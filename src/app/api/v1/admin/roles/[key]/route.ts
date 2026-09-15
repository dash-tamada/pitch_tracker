import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { ok, readJson, route } from "@/server/lib/http";
import { setRolePermissions } from "@/server/modules/users/admin";

export const PATCH = route<{ key: string }>({ auth: true }, async ({ req, session, params, ctx }) => {
  if (!/^[A-Z_]{3,50}$/.test(params.key)) throw new AppError("NOT_FOUND", "Role not found.");
  return ok(await setRolePermissions(getDb(), session!.actor, params.key, await readJson(req), ctx));
});
