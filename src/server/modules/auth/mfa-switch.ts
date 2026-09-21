/**
 * Development escape hatch for the second factor.
 *
 * Setting `MFA_DISABLED=1` turns TOTP off so a local instance can be used without an authenticator
 * app. It is deliberately ignored when APP_ENV is "production" or "staging", so copying the flag
 * into a real deployment by mistake cannot weaken it — there, MFA is always enforced.
 *
 * This only changes whether a second factor is *demanded*. It never deletes an enrolled secret, so
 * clearing the flag restores the previous behaviour for every account that had already set one up.
 */
export function mfaDisabled(): boolean {
  if (process.env.APP_ENV === "production" || process.env.APP_ENV === "staging") return false;
  return process.env.MFA_DISABLED === "1";
}
