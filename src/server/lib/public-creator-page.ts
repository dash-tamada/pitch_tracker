import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformDb } from "@/server/db/client";
import { PUBLIC_CREATOR_COOKIE } from "@/server/lib/public-creator-http";
import { resolvePublicSession, type PublicCreatorSession } from "@/server/modules/public-creators/auth";

/** The signed-in platform-wide creator, or null. */
export async function currentPublicCreator(): Promise<PublicCreatorSession | null> {
  return resolvePublicSession(getPlatformDb(), (await cookies()).get(PUBLIC_CREATOR_COOKIE())?.value);
}

/** For pages that need a signed-in creator: bounces to the sign-in / register screen otherwise. */
export async function requirePublicCreator(): Promise<PublicCreatorSession> {
  const c = await currentPublicCreator();
  if (!c) redirect("/creator");
  return c;
}
