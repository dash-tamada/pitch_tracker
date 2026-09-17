import { connection } from "next/server";
import { requirePortalLink } from "@/server/lib/creator-page-session";
import { PortalLoginForm } from "@/components/portal-login-form";

export default async function PortalLoginPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  await requirePortalLink(token); // 404s an unknown/disabled link before rendering the form
  return (
    <main className="auth">
      <PortalLoginForm token={token} />
    </main>
  );
}
