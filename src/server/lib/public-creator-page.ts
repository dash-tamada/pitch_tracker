import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformDb } from "@/server/db/client";
import { PUBLIC_CREATOR_COOKIE } from "@/server/lib/public-creator-http";
import { resolvePublicSession, type PublicCreatorSession } from "@/server/modules/public-creators/auth";

/** The signed-in writer (Creator Studio), or null. */
export async function currentPublicCreator(): Promise<PublicCreatorSession | null> {
  return resolvePublicSession(getPlatformDb(), (await cookies()).get(PUBLIC_CREATOR_COOKIE())?.value);
}

/** For studio pages that only need a signed-in writer (the profile page itself): everyone signs in on the one login page. */
export async function requirePublicCreator(): Promise<PublicCreatorSession> {
  const c = await currentPublicCreator();
  if (!c) redirect("/login");
  return c;
}

/** For the rest of the studio: the profile photo is required, so the studio stays closed until there is one. */
export async function requireStudio(): Promise<PublicCreatorSession> {
  const c = await requirePublicCreator();
  if (!c.hasPhoto) redirect("/creator/profile?complete=1");
  return c;
}
