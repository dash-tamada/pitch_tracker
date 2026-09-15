import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { requirePasswordSession } from "@/server/lib/page-session";
import { MfaEnrol } from "@/components/password-forms";

export default async function MfaSetupPage() {
  await connection();
  const s = await requirePasswordSession();
  const [u] = await getDb().select({ mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, s.actor.userId));
  if (u?.mfaEnabled && !s.mfaVerified) redirect("/login?step=mfa");
  if (s.mfaVerified && u?.mfaEnabled) redirect("/dashboard");
  return (
    <main className="auth">
      <div>
        <h1>Protect your account</h1>
        <p className="subtle">Your role requires two-factor authentication before you can use Pitch Tracker.</p>
        <MfaEnrol enabled={false} />
      </div>
    </main>
  );
}
