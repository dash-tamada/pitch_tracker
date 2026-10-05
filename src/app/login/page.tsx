import { connection } from "next/server";
import { LoginForm } from "@/components/login-form";
import { googleEnabled } from "@/server/modules/auth/google";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string }> }) {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const { step, error } = await searchParams;
  return (
    <main className="auth">
      <LoginForm initialStep={step === "mfa" ? "mfa" : "password"} google={googleEnabled()} urlError={error} />
    </main>
  );
}
