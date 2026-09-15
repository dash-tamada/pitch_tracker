import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { ok, route } from "@/server/lib/http";
import { can } from "@/server/modules/authz/policy";
import { executiveView } from "@/server/modules/analytics/service";

export const GET = route({ auth: true }, async ({ session }) => {
  if (!can(session!.actor, "pitch.view_all")) throw new AppError("FORBIDDEN", "Management only.");
  return ok(await executiveView(getDb(), session!.actor));
});
