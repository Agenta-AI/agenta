import {useProfile} from "@agenta/entities/profile"
import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {AuditLogPage, useEntitlements} from "@agenta/settings-ui"

import type {SettingsTabProps} from "./settingsTabProps"
import {useMobileSettingsAccess} from "./settingsTabs"
import {UpgradeActions} from "./UpgradeActions"
import {useUpgradePrompt} from "./upgradePrompt"
import {useSettingsOrg} from "./useSettingsOrg"

/** Settings > Audit Log, gated by the plan's audit entitlement and naming users from the roster. */
export const AuditLogTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const t = useT(settingsLicenseCatalog)
    const access = useMobileSettingsAccess()
    const {user} = useProfile()
    const {org} = useSettingsOrg(workspaceId)
    const entitlements = useEntitlements({projectId, enabled: access.isEE})
    const prompt = useUpgradePrompt({
        feature: "audit",
        screen: "auditLog",
        shown: !entitlements.isLoading && !entitlements.hasAudit,
    })
    return (
        <AuditLogPage
            hasAudit={entitlements.hasAudit}
            entitlementsLoading={entitlements.isLoading}
            upgradeAvailability={
                // The line under a self-hosted locked section; cloud keeps the plan names.
                prompt.selfHosted ? t("settings.license.availableWithEnterprise") : undefined
            }
            upgradeAction={
                prompt.selfHosted ? (
                    <UpgradeActions feature="audit" screen="auditLog" actions={prompt.actions} />
                ) : undefined
            }
            members={org.data?.default_workspace?.members}
            currentUserId={user?.id}
        />
    )
}
