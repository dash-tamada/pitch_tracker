import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CREATOR_SESSION_COOKIE } from "@/server/lib/creator-http";
import { requirePortalLink } from "@/server/lib/creator-page-session";
import { resolveCreatorSession } from "@/server/modules/creator-portal/auth";

export default async function PortalLandingPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const companyId = await requirePortalLink(token); // 404s an unknown/disabled link

  const creator = await resolveCreatorSession(companyId, (await cookies()).get(CREATOR_SESSION_COOKIE())?.value);
  if (creator) redirect(`/portal/${token}/pitches`);

  return (
    <main className="auth">
      {/* Reuses the .auth form { ... } card styling from globals.css — no inputs, just entry links. */}
      <form>
        <h1>Submit a pitch</h1>
        <p className="subtle">Register a new account or sign in to submit a pitch and upload your script.</p>
        <div className="row-actions">
          <a className="btn-inline" href={`/portal/${token}/register`}>Register</a>
          <a className="btn-secondary" href={`/portal/${token}/login`}>Sign in</a>
        </div>
      </form>
    </main>
  );
}
