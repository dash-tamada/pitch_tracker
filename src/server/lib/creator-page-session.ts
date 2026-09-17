import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CREATOR_SESSION_COOKIE } from "@/server/lib/creator-http";
import { resolveCreatorSession, resolvePortalCompany, type CreatorSessionInfo } from "@/server/modules/creator-portal/auth";

export interface CreatorPageContext { companyId: string; creator: CreatorSessionInfo; token: string }

/** For the landing/register/login pages: resolves the link only. 404s a disabled/unknown token — never leaks which. */
export async function requirePortalLink(token: string): Promise<string> {
  const companyId = await resolvePortalCompany(token);
  if (!companyId) notFound();
  return companyId;
}

/** For authenticated portal pages: resolves the link, then requires a valid creator session cookie for it. */
export async function requireCreatorPageSession(token: string): Promise<CreatorPageContext> {
  const companyId = await requirePortalLink(token);
  const creator = await resolveCreatorSession(companyId, (await cookies()).get(CREATOR_SESSION_COOKIE())?.value);
  if (!creator) redirect(`/portal/${token}/login`);
  return { companyId, creator, token };
}
