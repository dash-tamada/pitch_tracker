import { ChangePasswordForm } from "@/components/password-forms";
import { PageHeader } from "@/components/ui";

/** Voluntary password change for the signed-in Super Admin. Gated by the platform layout above (PLATFORM scope only). */
export default function PlatformSecurityPage() {
  return (
    <>
      <PageHeader title="Change password" />
      <ChangePasswordForm />
    </>
  );
}
