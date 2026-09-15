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

/** For the MFA set-up page only: a password-authenticated session that has not completed MFA yet. */
export async function requirePasswordSession(): Promise<SessionInfo> {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  const session = await resolveSession(getDb(), token);
  if (!session) redirect("/login");
  return session;
}

import { notFound } from "next/navigation";
import { AppError } from "./errors";

/** Runs a service call for a page: NOT_FOUND → 404 page; FORBIDDEN → null so the page can show a message. */
export async function pageData<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError && (e.code === "FORBIDDEN" || e.code === "NOT_CURRENT_OWNER")) return null;
    throw e;
  }
}
