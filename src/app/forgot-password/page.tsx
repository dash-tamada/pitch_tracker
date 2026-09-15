import { connection } from "next/server";
import { ForgotPasswordForm } from "@/components/password-forms";

export default async function ForgotPasswordPage() {
  await connection();
  return <main className="auth"><ForgotPasswordForm /></main>;
}
