/**
 * Sends the sign-in code over WhatsApp through Pinnacle (Pinbot) using an approved authentication template.
 *
 * Settings (all required in production):
 *   PINNACLE_API_URL           either the full endpoint (https://…/v3/<phone-number-id>/messages) or just the host
 *                              (https://partnersv1.pinbot.ai), in which case /v3/<PINNACLE_WABA_NUMBER_ID>/messages is added.
 *   PINNACLE_API_KEY           sent in the `apikey` header
 *   PINNACLE_WABA_NUMBER_ID    the WhatsApp phone-number id (also read as PINNACLE_WEBA_NUMBER_ID, a common misspelling)
 *   PINNACLE_WABA_NUMBER       the registered WhatsApp business number; PINNACLE_FROM is accepted as well
 *   PINNACLE_OTP_TEMPLATE_ID   the approved template: its NAME for the Meta style, its id for the legacy style
 * Optional:
 *   PINNACLE_API_STYLE         "meta" or "legacy". Default: "meta" when the URL contains /v<number>/, else "legacy".
 *   PINNACLE_OTP_LANGUAGE      template language code, Meta style (default "en")
 *   PINNACLE_OTP_BUTTON        "1" when the template has a Copy-code button: the code is then sent for the button too
 *
 * With none of the required settings set, local development logs the code to the server console instead of sending it.
 * In production an unconfigured provider is an error, never a silent fallback.
 */
// Pasted values often carry a stray space or line break, which in a URL or a header means "wrong credentials" — trim them all.
const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? "";
const fromNumber = () => env("PINNACLE_FROM", "PINNACLE_WABA_NUMBER");
const phoneId = () => env("PINNACLE_WABA_NUMBER_ID", "PINNACLE_WEBA_NUMBER_ID");
const apiKey = () => env("PINNACLE_API_KEY");
const templateId = () => env("PINNACLE_OTP_TEMPLATE_ID");
/** The endpoint to POST to: the configured URL, with the phone-number id path added when only the host was given. */
const endpoint = () => {
  const base = env("PINNACLE_API_URL");
  if (!base || /\/v\d+\//.test(base) || !phoneId()) return base;
  return `${base.replace(/\/+$/, "")}/v3/${phoneId()}/messages`;
};
const configured = () => Boolean(endpoint() && apiKey() && (fromNumber() || phoneId()) && templateId());
const isProd = () => process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" || process.env.NODE_ENV === "production";

/** Whether to offer WhatsApp sign-in: a real provider, or local development. */
export const whatsappOtpEnabled = () => configured() || !isProd();

const style = (): "meta" | "legacy" => {
  const s = process.env.PINNACLE_API_STYLE?.toLowerCase();
  if (s === "meta" || s === "legacy") return s;
  return /\/v\d+\//.test(endpoint()) ? "meta" : "legacy";
};

function requestBody(digitsTo: string, code: string): unknown {
  if (style() === "legacy") {
    return {
      from: fromNumber().replace(/\D/g, ""), to: digitsTo, type: "template",
      message: { templateid: templateId(), placeholders: [code] },
    };
  }
  const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: code }] }];
  // Authentication templates with a Copy-code button need the code a second time, for the button.
  if (process.env.PINNACLE_OTP_BUTTON === "1") components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: digitsTo, type: "template",
    template: { name: templateId(), language: { code: process.env.PINNACLE_OTP_LANGUAGE || "en" }, components },
  };
}

interface Attempt { label: string; url: URL; headers: Record<string, string> }
interface Outcome { status: number; rejected: boolean; reason: string }

/** Reads Pinnacle's reply. Only a few known status/error fields are ever surfaced — the raw body can echo the number or code. */
async function interpret(res: Response): Promise<Outcome> {
  const text = await res.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  const pick = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\d{6,}/g, "#").slice(0, 160) : "");
  const err = (body.error ?? {}) as Record<string, unknown>;
  const reason = pick(body.message) || pick(body.error_message) || pick(err.message) || pick(body.error) || pick(body.status) || pick(body.detail);
  // A real acceptance carries a message id (Meta: messages[0].id); providers also answer 200 with an error sentence,
  // so a reply with a plain `message` and no message id is a rejection, not a send.
  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
  const hasId = Boolean(messages[0]?.id || body.messageId || body.message_id || (body.success === true));
  const rejected = !res.ok || body.success === false || body.status === "failed" || body.status === "error" || Boolean(body.error) || (!hasId && typeof body.message === "string");
  return { status: res.status, rejected, reason };
}

/**
 * The attempts to make, in order. Normally one. With PINNACLE_DEBUG_FALLBACK=1 and the Meta style, a 401 (which sends nothing)
 * is retried with the other likely ways to authenticate — the business number in the URL instead of the phone-number id, and an
 * Authorization: Bearer header instead of `apikey` — and the log says which one Pinnacle accepted.
 */
function attempts(): Attempt[] {
  const main = new URL(endpoint());
  const json = { "content-type": "application/json" };
  const list: Attempt[] = [{ label: "id+apikey", url: main, headers: { ...json, apikey: apiKey() } }];
  const number = fromNumber().replace(/\D/g, "");
  if (process.env.PINNACLE_DEBUG_FALLBACK === "1" && style() === "meta") {
    const withNumber = number ? new URL(main.toString().replace(/\/v(\d+)\/[^/]+\//, `/v$1/${number}/`)) : null;
    if (withNumber) list.push({ label: "number+apikey", url: withNumber, headers: { ...json, apikey: apiKey() } });
    list.push({ label: "id+bearer", url: main, headers: { ...json, authorization: `Bearer ${apiKey()}` } });
    if (withNumber) list.push({ label: "number+bearer", url: withNumber, headers: { ...json, authorization: `Bearer ${apiKey()}` } });
  }
  return list;
}

export async function sendWhatsappOtp(e164: string, code: string): Promise<void> {
  if (!configured()) {
    if (isProd()) throw new Error("PINNACLE_* settings are not configured");
    console.log(`[dev] WhatsApp OTP for ${e164}: ${code}`);
    return;
  }
  const list = attempts();
  const first = list[0]!;
  console.log(JSON.stringify({ level: "info", route: "whatsapp-otp", step: "request", style: style(), host: first.url.host,
    path: first.url.pathname.replace(/\/v(\d+)\/[^/]+\//, "/v$1/<id>/"), idLength: phoneId().length, numberLength: fromNumber().replace(/\D/g, "").length,
    keyLength: apiKey().length, header: "apikey", attempts: list.length }));
  let last: Outcome | undefined;
  for (const a of list) {
    const res = await fetch(a.url, { method: "POST", headers: a.headers, body: JSON.stringify(requestBody(e164.replace(/\D/g, ""), code)), signal: AbortSignal.timeout(10_000) });
    last = await interpret(res);
    console.log(JSON.stringify({ level: last.rejected ? "warn" : "info", route: "whatsapp-otp", provider: "pinnacle", attempt: a.label, status: last.status, reply: last.reason || (last.rejected ? "rejected" : "accepted") }));
    if (!last.rejected) return;
    if (last.status !== 401) break; // only an authentication failure is worth another way of authenticating
  }
  throw new Error(`pinnacle ${last!.status}${last!.reason ? `: ${last!.reason}` : ""}`);
}
