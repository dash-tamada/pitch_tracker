import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requirePasswordSession } from "@/server/lib/page-session";
import { SetPasswordForm } from "@/components/password-forms";

/** Shown once, right after signing in with a temp password the platform assigned. Comes before MFA set-up. */
export default async function ChangePasswordPage() {
  await connection();
  const s = await requirePasswordSession();
  if (!s.passwordChangeRequired) redirect("/dashboard");
  return (
    <main className="auth">
      <div>
        <h1>Choose your password</h1>
        <p className="subtle">Your account was created with a temporary password. Set your own before continuing.</p>
        <SetPasswordForm endpoint="/api/v1/auth/password/change-required" heading="New password" sessionAuth />
      </div>
    </main>
  );
}
