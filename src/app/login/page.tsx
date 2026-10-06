import { connection } from "next/server";
import { CameraIntro } from "@/components/camera-intro";
import { LoginForm } from "@/components/login-form";
import { PosterWall } from "@/components/poster-wall";
import { googleEnabled } from "@/server/modules/auth/google";
import { whatsappOtpEnabled } from "@/server/modules/auth/whatsapp";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string; admin?: string }> }) {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const { step, error, admin } = await searchParams;
  const mfa = step === "mfa";
  const whatsapp = whatsappOtpEnabled();
  // Everyone signs in with a mobile number + WhatsApp code or Google; email and password stay only for platform administrators.
  const initialStep = mfa ? "mfa" : admin === "1" ? "password" : whatsapp ? "wa-mobile" : "social";
  return (
    <main className="auth auth-cinema">
      <PosterWall />
      {/* Someone arriving mid sign-in (two-factor step) or bounced back with an error goes straight to the
          board — the opening shot is for starting fresh, not a hurdle to clear twice. */}
      <CameraIntro skip={mfa || Boolean(error)}>
        <LoginForm initialStep={initialStep} google={googleEnabled()} whatsapp={whatsapp} urlError={error} />
      </CameraIntro>
    </main>
  );
}
