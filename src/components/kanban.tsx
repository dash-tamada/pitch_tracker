"use client";

import { useState } from "react";
import { api } from "./client-api";

export type KanbanCard = { id: string; title: string; creatorName: string; stageKey: string; stageName: string; ownerName: string | null; daysWaiting: number };
export const KANBAN_COLUMNS: { key: string; label: string; stages: string[] }[] = [
  { key: "new", label: "New", stages: ["SUBMITTED"] },
  { key: "initial", label: "Initial Review", stages: ["INITIAL_REVIEW"] },
  { key: "internal", label: "Internal Review", stages: ["INTERNAL_REVIEW", "CHANGES_REQUESTED", "ON_HOLD"] },
  { key: "senior", label: "Senior Review", stages: ["SENIOR_REVIEW"] },
  { key: "platform", label: "Platform", stages: ["APPROVED_FOR_PLATFORM", "PLATFORM_PITCHING"] },
  { key: "approved", label: "Approved", stages: ["PLATFORM_APPROVED", "READY_FOR_DEVELOPMENT"] },
  { key: "development", label: "Development", stages: ["DEVELOPMENT"] },
  { key: "production", label: "Production", stages: ["GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION"] },
  { key: "completed", label: "Completed", stages: ["COMPLETED", "RELEASED"] },
  { key: "rejected", label: "Rejected", stages: ["REJECTED"] },
];

/**
 * Dragging a card never changes anything by itself. The server is asked which actions this user may take now;
 * if one leads into the target column, the pitch opens with that action's form so required fields are still collected
 * and every rule is enforced by the workflow engine.
 */
export function KanbanBoard({ cards }: { cards: KanbanCard[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [hover, setHover] = useState<{ col: string; ok: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  async function drop(colKey: string) {
    const card = cards.find((c) => c.id === dragging);
    setHover(null); setDragging(null);
    if (!card) return;
    const col = KANBAN_COLUMNS.find((c) => c.key === colKey)!;
    if (col.stages.includes(card.stageKey)) return;
    try {
      const { actions } = await api<{ actions: { action: string; toStageKey: string | null }[] }>("GET", `/api/v1/pitches/${card.id}/actions`);
      const match = actions.find((a) => a.toStageKey && col.stages.includes(a.toStageKey));
      if (!match) { setMessage(`You can't move "${card.title}" to ${col.label} from its current stage.`); return; }
      window.location.assign(`/pitches/${card.id}?tab=workflow&suggest=${encodeURIComponent(match.action)}&to=${encodeURIComponent(match.toStageKey!)}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not check allowed moves."); }
  }

  return (
    <>
      {message && <p className="notice" role="status">{message}</p>}
      <div className="kanban">
        {KANBAN_COLUMNS.map((col) => {
          const colCards = cards.filter((c) => col.stages.includes(c.stageKey));
          const cls = hover?.col === col.key ? (hover.ok ? "kanban-col drop-ok" : "kanban-col drop-no") : "kanban-col";
          return (
            <section key={col.key} className={cls} aria-label={col.label}
              onDragOver={(e) => { e.preventDefault(); if (hover?.col !== col.key) setHover({ col: col.key, ok: true }); }}
              onDragLeave={() => setHover(null)} onDrop={(e) => { e.preventDefault(); void drop(col.key); }}>
              <h3><span>{col.label}</span><span className="muted">{colCards.length}</span></h3>
              {colCards.map((c) => (
                <article key={c.id} className="kanban-card" draggable onDragStart={() => setDragging(c.id)}>
                  <a href={`/pitches/${c.id}`}>{c.title}</a>
                  <div className="muted">{c.creatorName}</div>
                  <div>{c.stageName} · {c.ownerName ?? "—"}</div>
                  <div className="muted">{c.daysWaiting} days</div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
