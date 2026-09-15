import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ok, route } from "@/server/lib/http";

export const GET = route({ auth: true, allowWithoutMfa: true }, async ({ session }) => {
  const s = session!;
  const [u] = await getDb().select({ id: users.id, email: users.email, fullName: users.fullName, mfaEnabled: users.mfaEnabled })
    .from(users).where(eq(users.id, s.actor.userId));
  return ok({ user: u, roles: [...s.actor.roles], permissions: [...s.actor.permissions], mfaVerified: s.mfaVerified });
});
