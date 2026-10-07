import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CreatorDraftFiles } from "@/components/creator-draft-files";
import { CreatorDraftForm } from "@/components/creator-draft-form";
import { CreatorSendPanel } from "@/components/creator-send-panel";
import { WriterShell, creatorNav } from "@/components/writer-shell";
import { CreatorLogoutButton } from "@/components/creator-logout-button";
import { getPlatformDb } from "@/server/db/client";
import { requireStudio } from "@/server/lib/public-creator-page";
import { FILE_CATEGORIES, FORMATS, GENRES, LANGUAGES, getMyDraft } from "@/server/modules/public-creators/drafts";
import { housesPitchWentTo, listAcceptingHouses } from "@/server/modules/public-creators/studio";

export default async function DraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  await connection();
  const creator = await requireStudio();
  const { draftId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) notFound();
  const db = getPlatformDb();
  const { draft, files } = await getMyDraft(db, creator.creatorId, draftId).catch(() => notFound());
  const [houses, sentIds] = await Promise.all([listAcceptingHouses(db), housesPitchWentTo(db, creator.creatorId, draftId)]);
  return (
    <WriterShell area="Creator studio" nav={creatorNav("pitches")} actions={<CreatorLogoutButton />}>
      <p className="back-link"><a href="/creator">&larr; Your pitches</a></p>
      <CreatorDraftForm draft={draft} formats={FORMATS} languages={LANGUAGES} genres={GENRES} />
      <CreatorDraftFiles draftId={draft.id} files={files.map((f) => ({ id: f.id, title: f.title, categoryKey: f.categoryKey, originalFilename: f.originalFilename, sizeBytes: f.sizeBytes }))} categories={FILE_CATEGORIES} sentCount={sentIds.length} />
      <CreatorSendPanel draftId={draft.id} houses={houses} sentIds={sentIds} />
    </WriterShell>
  );
}
