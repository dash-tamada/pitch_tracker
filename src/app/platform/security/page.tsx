import { ChangePasswordForm } from "@/components/password-forms";
import { mfaDisabled } from "@/server/modules/auth/mfa-switch";
import { PageHeader } from "@/components/ui";

/** Voluntary password change for the signed-in Super Admin. Gated by the platform layout above (PLATFORM scope only). */
export default function PlatformSecurityPage() {
  return (
    <>
      <PageHeader title="Security" subtitle="Change the password for this Super Admin account. Every other session is signed out when it changes." />
      <div className="panel-form">
        <ChangePasswordForm mfaOn={!mfaDisabled()} />
      </div>
    </>
  );
}
