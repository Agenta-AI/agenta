import type {OrganizationFlags} from "@agenta/entities/organization"
import {useT} from "@agenta/i18n/settings"

import {SettingsSection} from "../shared/SettingsSection"

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
    const t = useT()
    // Turning off the last sign-in method would lock everyone out, so owner bypass is pinned on.
    const allAuthMethodsDisabled = !flags.allow_email && !flags.allow_social && !flags.allow_sso

    return (
        <div className="flex flex-col gap-8">
            {error ? (
                <p role="alert" className="m-0 text-[13px] text-colorError">
                    {error}
                </p>
            ) : null}

            <SettingsSection
                title={t("settings.access.signInMethods")}
                description={t("settings.access.signInMethodsDescription")}
            >
                <SettingToggleRow
                    title={t("settings.access.emailPassword")}
                    description={t("settings.access.emailPasswordDescription")}
                    enabled={flags.allow_email}
                    onChange={(checked) => onFlagChange("allow_email", checked)}
                    loading={updating}
                    showSuccess={lastSavedFlag === "allow_email"}
                />
                <SettingToggleRow
                    title={t("settings.access.socialLogin")}
                    description={t("settings.access.socialLoginDescription")}
                    enabled={flags.allow_social}
                    onChange={(checked) => onFlagChange("allow_social", checked)}
                    loading={updating}
                    showSuccess={lastSavedFlag === "allow_social"}
                />
                <SettingToggleRow
                    title={t("settings.access.ssoAuthentication")}
                    description={t("settings.access.ssoAuthenticationDescription")}
                    enabled={flags.allow_sso}
                    onChange={(checked) => onFlagChange("allow_sso", checked)}
                    disabled={!hasActiveVerifiedProvider}
                    disabledReason={t("settings.access.ssoDisabledReason")}
                    tooltip={t("settings.access.ssoTooltip")}
                    loading={updating}
                    showSuccess={lastSavedFlag === "allow_sso"}
                />
            </SettingsSection>

            <SettingsSection title={t("settings.access.membership")}>
                <SettingToggleRow
                    title={t("settings.access.autoJoin")}
                    description={t("settings.access.autoJoinDescription")}
                    enabled={flags.auto_join}
                    onChange={(checked) => onFlagChange("auto_join", checked)}
                    disabled={!hasVerifiedDomain}
                    disabledReason={t("settings.access.verifyDomainFirst")}
                    loading={updating}
                    showSuccess={lastSavedFlag === "auto_join"}
                />
                <SettingToggleRow
                    title={t("settings.access.restrictInvites")}
                    description={t("settings.access.restrictInvitesDescription")}
                    enabled={flags.domains_only}
                    onChange={(checked) => onFlagChange("domains_only", checked)}
                    disabled={!hasVerifiedDomain}
                    disabledReason={t("settings.access.verifyDomainFirst")}
                    loading={updating}
                    showSuccess={lastSavedFlag === "domains_only"}
                />
            </SettingsSection>

            <SettingsSection title={t("settings.access.admin")}>
                <SettingToggleRow
                    title={t("settings.access.ownersBypass")}
                    description={t("settings.access.ownersBypassDescription")}
                    enabled={flags.allow_root}
                    onChange={(checked) => onFlagChange("allow_root", checked)}
                    disabled={allAuthMethodsDisabled && flags.allow_root}
                    disabledReason={t("settings.access.ownersBypassDisabledReason")}
                    tooltip={t("settings.access.ownersBypassTooltip")}
                    loading={updating}
                    showSuccess={lastSavedFlag === "allow_root"}
                />
            </SettingsSection>
        </div>
    )
}
