import { connection } from "next/server";
import { CreatorLogoutButton } from "@/components/creator-logout-button";
import { CreatorPhoto } from "@/components/creator-photo";
import { CreatorProfileEditor } from "@/components/creator-profile-editor";
import type { DetailsState } from "@/components/profile-fields";
import { WriterShell, creatorNav } from "@/components/writer-shell";
import { getPlatformDb } from "@/server/db/client";
import { requirePublicCreator } from "@/server/lib/public-creator-page";
import { getMyProfile } from "@/server/modules/public-creators/profile";

export default async function CreatorProfilePage({ searchParams }: { searchParams: Promise<{ complete?: string }> }) {
  await connection();
  const me = await requirePublicCreator(); // not the full studio gate: this is the page that opens it
  const { complete } = await searchParams;
  const { creator, credits } = await getMyProfile(getPlatformDb(), me.creatorId);
  const initial: DetailsState = {
    fullName: creator.fullName, creatorType: creator.creatorType, experienceYears: creator.experienceYears?.toString() ?? "", bio: creator.bio ?? "",
    imdbUrl: creator.imdbUrl ?? "", showreelUrl: creator.showreelUrl ?? "", otherLinks: creator.otherLinks ?? [],
    credits: credits.map((c) => ({ projectTitle: c.projectTitle, credit: c.credit, releaseYear: c.releaseYear?.toString() ?? "", link: c.link ?? "" })),
  };
  return (
    <WriterShell area="Creator studio" nav={creatorNav("profile")} actions={<CreatorLogoutButton />}>
      <div className="page-head"><div><h1 className="page-title">Your profile</h1>
        <p className="subtle">This is what production houses see when you pitch to them. Change it any time.</p></div></div>
      {!me.hasPhoto && <p className="notice">{complete ? "One last step: add your profile photo. The studio opens as soon as it is uploaded." : "Add your profile photo to open the studio."}</p>}
      <div className="section"><h2>Profile photo</h2><CreatorPhoto hasPhoto={me.hasPhoto} required={!me.hasPhoto} /></div>
      <CreatorProfileEditor initial={initial} />
    </WriterShell>
  );
}
