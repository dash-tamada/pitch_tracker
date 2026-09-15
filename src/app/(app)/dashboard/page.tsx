import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { pitches, workflowDefinitions, workflowStages } from "@/server/db/schema";
import { requirePageSession } from "@/server/lib/page-session";
import { pitchVisibilityCondition } from "@/server/modules/authz/policy";

export default async function DashboardPage() {
  const { actor } = await requirePageSession();
  const db = getDb();
  // Real counts from the database, filtered by exactly the same visibility policy as every API.
  const rows = await db.select({ stage: workflowStages.name, sort: workflowStages.sortOrder, n: count(pitches.id) })
    .from(pitches)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, pitches.workflowDefinitionId))
    .innerJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
    .where(pitchVisibilityCondition(actor))
    .groupBy(workflowStages.name, workflowStages.sortOrder)
    .orderBy(workflowStages.sortOrder);
  const [mine] = await db.select({ n: count() }).from(pitches).where(and(pitchVisibilityCondition(actor), eq(pitches.currentOwnerId, actor.userId)));

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="subtle">Pipeline by stage — only stories you are allowed to see are counted.</p>
      <div className="cards">
        <div className="card"><div className="label">Awaiting my action</div><div className="value">{mine?.n ?? 0}</div></div>
        {rows.map((r) => <div className="card" key={r.stage}><div className="label">{r.stage}</div><div className="value">{r.n}</div></div>)}
      </div>
      {rows.length === 0 && <p className="empty">No pitches yet.</p>}
    </>
  );
}
