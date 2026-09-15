import { connection } from "next/server";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const { step } = await searchParams;
  return (
    <main className="auth">
      <LoginForm initialStep={step === "mfa" ? "mfa" : "password"} />
    </main>
  );
}
