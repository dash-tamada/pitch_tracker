import { connection } from "next/server";
import { requirePortalLink } from "@/server/lib/creator-page-session";
import { CREATOR_TYPES } from "@/server/modules/creators/service";
import { PortalRegisterForm } from "@/components/portal-register-form";

const LABELS: Record<string, string> = {
  WRITER: "Writer", DIRECTOR: "Director", WRITER_DIRECTOR: "Writer-Director", PRODUCER: "Producer", CREATOR: "Creator", OTHER: "Other",
};

export default async function PortalRegisterPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  await requirePortalLink(token); // 404s an unknown/disabled link before rendering the form
  const creatorTypes = CREATOR_TYPES.map((k) => ({ key: k, label: LABELS[k] ?? k }));
  return (
    <main className="auth">
      <PortalRegisterForm token={token} creatorTypes={creatorTypes} />
    </main>
  );
}
