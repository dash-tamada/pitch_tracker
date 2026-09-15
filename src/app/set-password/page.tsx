import { connection } from "next/server";
import { SetPasswordForm } from "@/components/password-forms";

export default async function SetPasswordPage() {
  await connection();
  return <main className="auth"><SetPasswordForm /></main>;
}
