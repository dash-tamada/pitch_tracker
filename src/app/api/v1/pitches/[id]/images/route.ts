import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { listPitchImages } from "@/server/modules/documents/service";
import { getStorage } from "@/server/modules/storage";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok({ images: await listPitchImages(getDb(), getStorage(), session!.actor, uuidParam(params.id, "Pitch")) }));
