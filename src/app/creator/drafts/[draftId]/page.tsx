import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CreatorDraftFiles } from "@/components/creator-draft-files";
import { CreatorDraftForm } from "@/components/creator-draft-form";
import { getPlatformDb } from "@/server/db/client";
import { requirePublicCreator } from "@/server/lib/public-creator-page";
import { FILE_CATEGORIES, FORMATS, GENRES, LANGUAGES, getMyDraft } from "@/server/modules/public-creators/drafts";

export default async function DraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  await connection();
  const creator = await requirePublicCreator();
  const { draftId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) notFound();
  const { draft, files } = await getMyDraft(getPlatformDb(), creator.creatorId, draftId).catch(() => notFound());
  const readOnly = draft.status !== "DRAFT";
  return (
    <main className="creator-shell">
      <p><a href="/creator">← Your pitches</a></p>
      {readOnly && <p className="notice">This pitch has been sent and can no longer be edited.</p>}
      <CreatorDraftForm draft={draft} formats={FORMATS} languages={LANGUAGES} genres={GENRES} readOnly={readOnly} />
      <CreatorDraftFiles draftId={draft.id} files={files.map((f) => ({ id: f.id, title: f.title, categoryKey: f.categoryKey, originalFilename: f.originalFilename, sizeBytes: f.sizeBytes }))} categories={FILE_CATEGORIES} readOnly={readOnly} />
    </main>
  );
}
