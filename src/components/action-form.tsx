"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

export type Option = { value: string; label: string };
export type FieldSpec =
  | { name: string; label: string; type: "text" | "textarea" | "date" | "email" | "url" | "password"; required?: boolean; placeholder?: string; defaultValue?: string; hint?: string; maxLength?: number }
  | { name: string; label: string; type: "number"; required?: boolean; min?: number; max?: number; defaultValue?: number; hint?: string }
  | { name: string; label: string; type: "select"; options: Option[]; required?: boolean; defaultValue?: string; hint?: string }
  | { name: string; label: string; type: "checkboxes"; options: Option[]; required?: boolean; defaultValue?: string[]; hint?: string }
  | { name: string; label: string; type: "checkbox"; defaultValue?: boolean; hint?: string }
  | { name: string; label: string; type: "user"; roles?: string[]; required?: boolean; hint?: string }
  | { name: string; label: string; type: "stars"; required?: boolean; hint?: string };

export interface ActionFormProps {
  endpoint: string;
  method?: "POST" | "PATCH";
  fields: FieldSpec[];
  submitLabel: string;
  title?: string;
  description?: string;
  /** Fixed values merged into the body (e.g. expectedVersion, action). */
  extra?: Record<string, unknown>;
  /** Wrap user-entered values under this key before sending (e.g. "rating"). */
  after?: "reload" | { href: string } | "result";
  danger?: boolean;
  collapsed?: boolean;
  confirm?: string;
}

type Dir = { id: string; fullName: string; roles: string[] };

function UserSelect({ name, roles, required }: { name: string; roles?: string[]; required?: boolean }) {
  const [users, setUsers] = useState<Dir[] | null>(null);
  const roleKey = roles?.join(",") ?? "";
  useEffect(() => {
    const q = roleKey ? `?roles=${encodeURIComponent(roleKey)}` : "";
    api<{ users: Dir[] }>("GET", `/api/v1/users/directory${q}`).then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, [roleKey]);
  return (
    <select name={name} required={required} defaultValue="">
      <option value="" disabled>{users === null ? "Loading…" : "Choose a person"}</option>
      {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.fullName} · {u.roles.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}</option>)}
    </select>
  );
}

export function ActionForm({ endpoint, method = "POST", fields, submitLabel, title, description, extra, after = "reload", danger, collapsed, confirm }: ActionFormProps) {
  const [open, setOpen] = useState(!collapsed);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!open) return <button type="button" className={danger ? "btn-secondary btn-danger" : "btn-secondary"} onClick={() => setOpen(true)}>{title ?? submitLabel}</button>;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true); setError(null); setFieldErrors({}); setResult(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...(extra ?? {}) };
    for (const f of fields) {
      if (f.type === "checkboxes") { const v = fd.getAll(f.name).map(String); if (v.length) body[f.name] = v; continue; }
      if (f.type === "checkbox") { body[f.name] = fd.get(f.name) === "on"; continue; }
      const raw = String(fd.get(f.name) ?? "").trim();
      if (raw === "") continue;
      body[f.name] = f.type === "number" || f.type === "stars" ? Number(raw) : raw;
    }
    // Dotted names build nested objects, e.g. "rating.overall".
    for (const k of Object.keys(body)) {
      if (!k.includes(".")) continue;
      const [a, b] = k.split(".", 2) as [string, string];
      body[a] = { ...((body[a] as Record<string, unknown>) ?? {}), [b]: body[k] };
      delete body[k];
    }
    try {
      const r = await api<Record<string, unknown>>(method, endpoint, body);
      if (after === "reload") window.location.reload();
      else if (after === "result") { setResult(JSON.stringify(r)); setBusy(false); }
      else window.location.assign(after.href.replace(":id", String(r.id ?? "")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      setBusy(false);
    }
  }

  return (
    <form className="section" onSubmit={submit} noValidate>
      {title && <h2>{title}</h2>}
      {description && <p className="subtle">{description}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {result && <p className="success">{result}</p>}
      <div className="form-grid">
        {fields.map((f) => {
          const err = fieldErrors[f.name] ?? fieldErrors[f.name.split(".").pop()!];
          const full = f.type === "textarea" || f.type === "checkboxes" ? "field full" : "field";
          return (
            <label key={f.name} className={full}>
              <span>{f.label}{"required" in f && f.required ? " *" : ""}</span>
              {f.type === "textarea" && <textarea name={f.name} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue} maxLength={f.maxLength} />}
              {(f.type === "text" || f.type === "date" || f.type === "email" || f.type === "url" || f.type === "password") &&
                <input name={f.name} type={f.type} autoComplete={f.type === "password" ? "new-password" : undefined} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue} maxLength={f.maxLength} />}
              {f.type === "number" && <input name={f.name} type="number" required={f.required} min={f.min} max={f.max} defaultValue={f.defaultValue} />}
              {f.type === "select" && (
                <select name={f.name} required={f.required} defaultValue={f.defaultValue ?? ""}>
                  {!f.required || !f.defaultValue ? <option value="">—</option> : null}
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {f.type === "checkboxes" && (
                <span className="chips">{f.options.map((o) => (
                  <span key={o.value} className="chip"><input type="checkbox" name={f.name} value={o.value} defaultChecked={f.defaultValue?.includes(o.value)} /> {o.label}</span>
                ))}</span>
              )}
              {f.type === "checkbox" && <input name={f.name} type="checkbox" defaultChecked={f.defaultValue} />}
              {f.type === "user" && <UserSelect name={f.name} roles={f.roles} required={f.required} />}
              {f.type === "stars" && (
                <select name={f.name} required={f.required} defaultValue="">
                  <option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5 - n)} ({n})</option>)}
                </select>
              )}
              {f.hint && <span className="hint">{f.hint}</span>}
              {err && <span className="field-error">{err}</span>}
            </label>
          );
        })}
      </div>
      <div className="row-actions">
        <button className={danger ? "btn-inline btn-danger-solid" : "btn-inline"} disabled={busy}>{busy ? "Please wait…" : submitLabel}</button>
        {collapsed && <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </form>
  );
}
