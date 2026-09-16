import { connection } from "next/server";
import { SetPasswordForm } from "@/components/password-forms";

export default async function AcceptInvitePage() {
  await connection();
  return <main className="auth"><SetPasswordForm endpoint="/api/v1/auth/invitation/accept" heading="Join your company on Pitch Tracker" /></main>;
}
