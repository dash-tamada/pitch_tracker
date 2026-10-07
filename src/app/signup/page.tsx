import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CreatorSignup } from "@/components/creator-signup";
import { PosterWall } from "@/components/poster-wall";
import { currentPublicCreator } from "@/server/lib/public-creator-page";

/** Writers and directors sign up here. There is no separate writer login: everyone signs in on /login. */
export default async function SignupPage() {
  await connection(); // dynamic rendering so the CSP nonce is applied
  if (await currentPublicCreator()) redirect("/creator");
  return (
    <main className="auth auth-cinema">
      <PosterWall />
      <CreatorSignup />
    </main>
  );
}
