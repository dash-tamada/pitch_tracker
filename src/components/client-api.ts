"use client";

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly fields?: Record<string, string>) { super(message); }
}

function csrfToken(): string {
  const name = document.cookie.includes("__Host-pt_csrf=") ? "__Host-pt_csrf" : "pt_csrf";
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? "";
}

export async function api<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-csrf-token": csrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.message ?? "Something went wrong. Please try again.", data?.error?.code ?? "INTERNAL", data?.error?.fields);
  return data as T;
}

export function csrfHeader(): Record<string, string> {
  return { "x-csrf-token": csrfToken() };
}
