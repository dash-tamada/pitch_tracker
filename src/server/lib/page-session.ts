import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPlatformDb } from "@/server/db/client";
import { resolveSession, type SessionInfo } from "@/server/modules/auth/service";
import { SESSION_COOKIE } from "./http";

/** For company pages: a verified company session (use `getDb(session.actor)` for data). Platform accounts go to /platform. */
export async function requirePageSession(): Promise<SessionInfo> {
  const session = await verifiedSession();
  if (session.actor.scope !== "COMPANY") redirect("/platform");
  return session;
}

/** For platform (Super Admin) pages. Company accounts never see them. */
export async function requirePlatformPageSession(): Promise<SessionInfo> {
  const session = await verifiedSession();
  if (session.actor.scope !== "PLATFORM") notFound();
  return session;
}

async function verifiedSession(): Promise<SessionInfo> {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  const session = await resolveSession(getPlatformDb(), token);
  if (!session) redirect("/login");
  // A platform-assigned temp password must be replaced before anything else, including MFA enrolment.
  if (session.passwordChangeRequired) redirect("/change-password");
  if (!session.mfaVerified) redirect("/login?step=mfa");
  return session;
}

/** For the change-password and MFA set-up pages only: a password-authenticated session, MFA/change-password not required yet. */
export async function requirePasswordSession(): Promise<SessionInfo> {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  const session = await resolveSession(getPlatformDb(), token);
  if (!session) redirect("/login");
  return session;
}

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
