import { connection } from "next/server";
import { CreatorDraftForm } from "@/components/creator-draft-form";
import { requirePublicCreator } from "@/server/lib/public-creator-page";
import { FORMATS, GENRES, LANGUAGES } from "@/server/modules/public-creators/drafts";

export default async function NewDraftPage() {
  await connection();
  await requirePublicCreator();
  return (
    <main className="creator-shell">
      <p><a href="/creator">← Your pitches</a></p>
      <CreatorDraftForm formats={FORMATS} languages={LANGUAGES} genres={GENRES} />
      <p className="subtle">After you create the pitch you can upload your script and other material.</p>
    </main>
  );
}
