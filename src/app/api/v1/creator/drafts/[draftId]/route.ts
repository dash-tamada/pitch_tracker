import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { deleteDraft, getMyDraft, updateDraft } from "@/server/modules/public-creators/drafts";
import { getStorage } from "@/server/modules/storage";

type P = { draftId: string };
export const GET = publicCreatorRoute<P>({}, async ({ db, creator, params }) => ok(await getMyDraft(db, creator!.creatorId, params.draftId)));
export const PATCH = publicCreatorRoute<P>({}, async ({ req, db, creator, params }) => ok(await updateDraft(db, creator!.creatorId, params.draftId, await readJson(req))));
export const DELETE = publicCreatorRoute<P>({}, async ({ db, creator, params }) => ok(await deleteDraft(db, creator!.creatorId, params.draftId, getStorage())));
