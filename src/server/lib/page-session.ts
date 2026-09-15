import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { resolveSession, type SessionInfo } from "@/server/modules/auth/service";
import { SESSION_COOKIE } from "./http";

/** For server components: returns the verified session or redirects to sign-in. */
export async function requirePageSession(): Promise<SessionInfo> {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  const session = await resolveSession(getDb(), token);
  if (!session) redirect("/login");
  if (!session.mfaVerified) redirect("/login?step=mfa");
  return session;
}
