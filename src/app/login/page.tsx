import { connection } from "next/server";
import { CameraIntro } from "@/components/camera-intro";
import { LoginForm } from "@/components/login-form";
import { PosterWall } from "@/components/poster-wall";
import { googleEnabled } from "@/server/modules/auth/google";
import { whatsappOtpEnabled } from "@/server/modules/auth/whatsapp";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string }> }) {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const { step, error } = await searchParams;
  const mfa = step === "mfa";
  return (
    <main className="auth auth-cinema">
      <PosterWall />
      {/* Someone arriving mid sign-in (two-factor step) or bounced back with an error goes straight to the
          board — the opening shot is for starting fresh, not a hurdle to clear twice. */}
      <CameraIntro skip={mfa || Boolean(error)}>
        <LoginForm initialStep={mfa ? "mfa" : "password"} google={googleEnabled()} whatsapp={whatsappOtpEnabled()} urlError={error} />
      </CameraIntro>
    </main>
  );
}
