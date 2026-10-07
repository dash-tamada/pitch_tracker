import { connection } from "next/server";
import { CreatorDraftForm } from "@/components/creator-draft-form";
import { WriterShell, creatorNav } from "@/components/writer-shell";
import { CreatorLogoutButton } from "@/components/creator-logout-button";
import { requirePublicCreator } from "@/server/lib/public-creator-page";
import { FORMATS, GENRES, LANGUAGES } from "@/server/modules/public-creators/drafts";

export default async function NewDraftPage() {
  await connection();
  await requirePublicCreator();
  return (
    <WriterShell area="Creator studio" nav={creatorNav("new")} actions={<CreatorLogoutButton />}>
      <CreatorDraftForm formats={FORMATS} languages={LANGUAGES} genres={GENRES} />
      <p className="subtle">After you create the pitch you can upload your script and other material.</p>
    </WriterShell>
  );
}
