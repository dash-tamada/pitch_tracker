import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { setEmailDomains } from "@/server/modules/platform/service";

/** Replaces the company's allowed email domains. */
export const POST = route<{ id: string }>({ auth: true, scope: "PLATFORM" }, async ({ req, session, params, ctx }) => {
  const body = (await readJson(req)) as { domains?: unknown };
  // The form sends one domain per line; the service validates every entry.
  const domains = typeof body?.domains === "string" ? body.domains.split(/[\s,]+/).filter(Boolean) : body?.domains;
  return ok(await setEmailDomains(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"), { domains }, ctx));
});
