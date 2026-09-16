import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { requirePageSession } from "@/server/lib/page-session";
import { MfaEnrol } from "@/components/password-forms";
import { PageHeader } from "@/components/ui";

export default async function AccountPage() {
  const { actor } = await requirePageSession();
  const [u] = await getDb(actor).select({ fullName: users.fullName, email: users.email, mfaEnabled: users.mfaEnabled, clearance: users.clearance }).from(users).where(eq(users.id, actor.userId));
  return (
    <>
      <PageHeader title="My account" />
      <dl className="kv section"><dt>Name</dt><dd>{u?.fullName}</dd><dt>Email</dt><dd>{u?.email}</dd><dt>Roles</dt><dd>{[...actor.roles].join(", ")}</dd><dt>Clearance</dt><dd>{u?.clearance}</dd></dl>
      <MfaEnrol enabled={Boolean(u?.mfaEnabled)} />
      <p className="subtle">To change your password, sign out and use “Forgot password” on the sign-in page.</p>
    </>
  );
}
