import type {OrganizationFlags} from "@agenta/entities/organization"

import {SettingToggleRow} from "./SettingToggleRow"

export type AuthFlagKey = keyof Pick<
    OrganizationFlags,
    "allow_email" | "allow_social" | "allow_sso" | "auto_join" | "domains_only" | "allow_root"
>

export interface AccessControlsSectionProps {
    flags: OrganizationFlags
    onFlagChange: (flag: AuthFlagKey, value: boolean) => void
    updating?: boolean
    /** The flag that just saved — drives the transient "Saved" marker. */
    lastSavedFlag?: AuthFlagKey | null
    /** SSO cannot be switched on before a provider exists and is verified. */
    hasActiveVerifiedProvider?: boolean
    /** Domain-scoped membership rules need at least one verified domain. */
    hasVerifiedDomain?: boolean
    /** A failed save. Without it the switch just flips back and the viewer is told nothing. */
    error?: string | null
}

const SectionLabel = ({children}: {children: React.ReactNode}) => (
    <div className="pb-2 pt-4 text-xs font-medium uppercase tracking-wider text-colorTextTertiary">
        {children}
    </div>
)

/** How members sign in, and who is allowed to join. */
export const AccessControlsSection = ({
    flags,
    onFlagChange,
    updating,
    lastSavedFlag,
    hasActiveVerifiedProvider = false,
    hasVerifiedDomain = false,
    error,
}: AccessControlsSectionProps) => {
    // Turning off the last sign-in method would lock everyone out, so owner bypass is pinned on.
    const allAuthMethodsDisabled = !flags.allow_email && !flags.allow_social && !flags.allow_sso

    return (
        <section className="flex flex-col">
            <div className="pb-2">
                <h2 className="m-0 text-lg font-medium text-colorText">Access Controls</h2>
                <p className="m-0 mt-1 text-xs text-colorTextSecondary">
                    Configure how users authenticate and join your organization
                </p>
                {error ? (
                    <p role="alert" className="m-0 mt-2 text-xs text-colorError">
                        {error}
                    </p>
                ) : null}
            </div>

            <SectionLabel>Sign-in methods</SectionLabel>
            <SettingToggleRow
                title="Email & password"
                description="Members can sign in with their email and a password"
                enabled={flags.allow_email}
                onChange={(checked) => onFlagChange("allow_email", checked)}
                loading={updating}
                showSuccess={lastSavedFlag === "allow_email"}
            />
            <SettingToggleRow
                title="Social login"
                description="Allow sign-in with Google, GitHub, or other OAuth providers"
                enabled={flags.allow_social}
                onChange={(checked) => onFlagChange("allow_social", checked)}
                loading={updating}
                showSuccess={lastSavedFlag === "allow_social"}
            />
            <SettingToggleRow
                title="SSO authentication"
                description="Enable single sign-on through your identity provider"
                enabled={flags.allow_sso}
                onChange={(checked) => onFlagChange("allow_sso", checked)}
                disabled={!hasActiveVerifiedProvider}
                disabledReason="Add an SSO provider below to enable"
                tooltip="OIDC supported. Configure your IdP in the SSO Providers section below."
                loading={updating}
                showSuccess={lastSavedFlag === "allow_sso"}
            />

            <SectionLabel>Membership</SectionLabel>
            <SettingToggleRow
                title="Auto-join from verified domains"
                description="Users with a verified domain email are automatically added to this organization"
                enabled={flags.auto_join}
                onChange={(checked) => onFlagChange("auto_join", checked)}
                disabled={!hasVerifiedDomain}
                disabledReason="Verify at least one domain first"
                loading={updating}
                showSuccess={lastSavedFlag === "auto_join"}
            />
            <SettingToggleRow
                title="Restrict invites to verified domains"
                description="Only allow inviting users whose email matches a verified domain"
                enabled={flags.domains_only}
                onChange={(checked) => onFlagChange("domains_only", checked)}
                disabled={!hasVerifiedDomain}
                disabledReason="Verify at least one domain first"
                loading={updating}
                showSuccess={lastSavedFlag === "domains_only"}
            />

            <SectionLabel>Admin</SectionLabel>
            <SettingToggleRow
                title="Owners bypass restrictions"
                description="Owners can sign in and invite members regardless of the restrictions above"
                enabled={flags.allow_root}
                onChange={(checked) => onFlagChange("allow_root", checked)}
                disabled={allAuthMethodsDisabled && flags.allow_root}
                disabledReason="Enable at least one sign-in method first"
                tooltip="Prevents account lockout. Keep enabled if all sign-in methods are disabled."
                loading={updating}
                showSuccess={lastSavedFlag === "allow_root"}
            />
        </section>
    )
}
