import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CreatorDraftFiles } from "@/components/creator-draft-files";
import { CreatorDraftForm } from "@/components/creator-draft-form";
import { CreatorSendPanel } from "@/components/creator-send-panel";
import { getPlatformDb } from "@/server/db/client";
import { requirePublicCreator } from "@/server/lib/public-creator-page";
import { FILE_CATEGORIES, FORMATS, GENRES, LANGUAGES, getMyDraft } from "@/server/modules/public-creators/drafts";
import { listSendableCompanies } from "@/server/modules/public-creators/send";
import { companies } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export default async function DraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  await connection();
  const creator = await requirePublicCreator();
  const { draftId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) notFound();
  const { draft, files } = await getMyDraft(getPlatformDb(), creator.creatorId, draftId).catch(() => notFound());
  const readOnly = draft.status !== "DRAFT";
  const db = getPlatformDb();
  const sentTo = draft.sentCompanyId ? (await db.select({ name: companies.name }).from(companies).where(eq(companies.id, draft.sentCompanyId)))[0]?.name : undefined;
  const options = readOnly ? [] : await listSendableCompanies(db);
  return (
    <main className="creator-shell">
      <p><a href="/creator">← Your pitches</a></p>
      {readOnly && <p className="success">Sent{sentTo ? ` to ${sentTo}` : ""}{draft.sentAt ? ` on ${draft.sentAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}` : ""}. It can no longer be edited here.</p>}
      <CreatorDraftForm draft={draft} formats={FORMATS} languages={LANGUAGES} genres={GENRES} readOnly={readOnly} />
      <CreatorDraftFiles draftId={draft.id} files={files.map((f) => ({ id: f.id, title: f.title, categoryKey: f.categoryKey, originalFilename: f.originalFilename, sizeBytes: f.sizeBytes }))} categories={FILE_CATEGORIES} readOnly={readOnly} />
          {!readOnly && <CreatorSendPanel draftId={draft.id} companies={options} />}
    </main>
  );
}
