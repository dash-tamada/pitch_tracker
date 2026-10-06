import { cookies } from "next/headers";
import { connection } from "next/server";
import { CameraIntro } from "@/components/camera-intro";
import { LoginForm } from "@/components/login-form";
import { PosterWall } from "@/components/poster-wall";
import { getPlatformDb } from "@/server/db/client";
import { SESSION_COOKIE } from "@/server/lib/http";
import { googleEnabled } from "@/server/modules/auth/google";
import { resolveSession } from "@/server/modules/auth/service";
import { whatsappOtpEnabled } from "@/server/modules/auth/whatsapp";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string; admin?: string; ready?: string }> }) {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const { step, error, admin, ready } = await searchParams;
  const mfa = step === "mfa";
  const whatsapp = whatsappOtpEnabled();
  // Everyone signs in with a mobile number + WhatsApp code or Google; email and password stay only for platform administrators.
  // Back from Google (or any sign-in that already created a session): the slate is ready and waits for Action.
  const session = ready === "1" ? await resolveSession(getPlatformDb(), (await cookies()).get(SESSION_COOKIE())?.value) : null;
  const isReady = Boolean(session && session.mfaVerified && !session.passwordChangeRequired);
  const initialStep = isReady ? "ready" : mfa ? "mfa" : admin === "1" ? "password" : whatsapp ? "wa-mobile" : "social";
  return (
    <main className="auth auth-cinema">
      <PosterWall />
      {/* Someone arriving mid sign-in (two-factor step) or bounced back with an error goes straight to the
          board — the opening shot is for starting fresh, not a hurdle to clear twice. */}
      <CameraIntro skip={mfa || isReady || Boolean(error)}>
        <LoginForm initialStep={initialStep} google={googleEnabled()} whatsapp={whatsapp} urlError={error} />
      </CameraIntro>
    </main>
  );
}
