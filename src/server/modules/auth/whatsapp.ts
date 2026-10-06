/**
 * Sends the sign-in code over WhatsApp through Pinnacle (Pinbot) using an approved authentication template.
 *
 * Settings (all required in production):
 *   PINNACLE_API_URL           the "send message" endpoint from the Pinnacle console. For the Meta-style API
 *                              (https://…/v3/<phone-number-id>/messages) the phone-number id is part of the URL.
 *   PINNACLE_API_KEY           sent in the `apikey` header
 *   PINNACLE_FROM              the registered WhatsApp business number (legacy style only)
 *   PINNACLE_OTP_TEMPLATE_ID   the approved template: its NAME for the Meta style, its id for the legacy style
 * Optional:
 *   PINNACLE_API_STYLE         "meta" or "legacy". Default: "meta" when the URL contains /v<number>/, else "legacy".
 *   PINNACLE_OTP_LANGUAGE      template language code, Meta style (default "en")
 *   PINNACLE_OTP_BUTTON        "1" when the template has a Copy-code button: the code is then sent for the button too
 *
 * With none of the required settings set, local development logs the code to the server console instead of sending it.
 * In production an unconfigured provider is an error, never a silent fallback.
 */
const configured = () => Boolean(process.env.PINNACLE_API_URL && process.env.PINNACLE_API_KEY && process.env.PINNACLE_FROM && process.env.PINNACLE_OTP_TEMPLATE_ID);
const isProd = () => process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" || process.env.NODE_ENV === "production";

/** Whether to offer WhatsApp sign-in: a real provider, or local development. */
export const whatsappOtpEnabled = () => configured() || !isProd();

const style = (): "meta" | "legacy" => {
  const s = process.env.PINNACLE_API_STYLE?.toLowerCase();
  if (s === "meta" || s === "legacy") return s;
  return /\/v\d+\//.test(process.env.PINNACLE_API_URL ?? "") ? "meta" : "legacy";
};

function requestBody(digitsTo: string, code: string): unknown {
  if (style() === "legacy") {
    return {
      from: process.env.PINNACLE_FROM!.replace(/\D/g, ""), to: digitsTo, type: "template",
      message: { templateid: process.env.PINNACLE_OTP_TEMPLATE_ID!, placeholders: [code] },
    };
  }
  const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: code }] }];
  // Authentication templates with a Copy-code button need the code a second time, for the button.
  if (process.env.PINNACLE_OTP_BUTTON === "1") components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: digitsTo, type: "template",
    template: { name: process.env.PINNACLE_OTP_TEMPLATE_ID!, language: { code: process.env.PINNACLE_OTP_LANGUAGE || "en" }, components },
  };
}

export async function sendWhatsappOtp(e164: string, code: string): Promise<void> {
  if (!configured()) {
    if (isProd()) throw new Error("PINNACLE_* settings are not configured");
    console.log(`[dev] WhatsApp OTP for ${e164}: ${code}`);
    return;
  }
  const res = await fetch(process.env.PINNACLE_API_URL!, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: process.env.PINNACLE_API_KEY! },
    body: JSON.stringify(requestBody(e164.replace(/\D/g, ""), code)),
    signal: AbortSignal.timeout(10_000),
  });
  // The reply can echo the number or code, so only a few known status/error fields are ever surfaced — never the raw body.
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
  if (rejected) throw new Error(`pinnacle ${res.status}${reason ? `: ${reason}` : ""}`);
  console.log(JSON.stringify({ level: "info", route: "whatsapp-otp", provider: "pinnacle", status: res.status, reply: reason || "accepted" }));
}
