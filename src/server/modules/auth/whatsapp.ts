/**
 * Sends the sign-in code over WhatsApp through Pinnacle (Pinbot) using an approved authentication template.
 *
 * Settings (all required in production):
 *   PINNACLE_API_URL           the "send template message" endpoint from the Pinnacle console
 *   PINNACLE_API_KEY           sent in the `apikey` header
 *   PINNACLE_FROM              the registered WhatsApp business number
 *   PINNACLE_OTP_TEMPLATE_ID   the approved template whose single placeholder is the code
 *
 * With none of them set, local development logs the code to the server console instead of sending it.
 * In production an unconfigured provider is an error, never a silent fallback.
 */
const configured = () => Boolean(process.env.PINNACLE_API_URL && process.env.PINNACLE_API_KEY && process.env.PINNACLE_FROM && process.env.PINNACLE_OTP_TEMPLATE_ID);
const isProd = () => process.env.APP_ENV === "production" || process.env.APP_ENV === "staging" || process.env.NODE_ENV === "production";

/** Whether to offer "Sign in with WhatsApp": a real provider, or local development. */
export const whatsappOtpEnabled = () => configured() || !isProd();

export async function sendWhatsappOtp(e164: string, code: string): Promise<void> {
  if (!configured()) {
    if (isProd()) throw new Error("PINNACLE_* settings are not configured");
    console.log(`[dev] WhatsApp OTP for ${e164}: ${code}`);
    return;
  }
  const res = await fetch(process.env.PINNACLE_API_URL!, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: process.env.PINNACLE_API_KEY! },
    body: JSON.stringify({
      from: process.env.PINNACLE_FROM!.replace(/\D/g, ""),
      to: e164.replace(/\D/g, ""),
      type: "template",
      message: { templateid: process.env.PINNACLE_OTP_TEMPLATE_ID!, placeholders: [code] },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`pinnacle responded ${res.status}`); // never include the body: it can echo the number/code
}
