import {useProfile} from "@agenta/entities/profile"
import {AuditLogPage, useEntitlements} from "@agenta/settings-ui"

import type {SettingsTabProps} from "./settingsTabProps"
import {useMobileSettingsAccess} from "./settingsTabs"
import {UpgradeActions} from "./UpgradeActions"
import {SELF_HOSTED_AVAILABILITY, useUpgradePrompt} from "./upgradePrompt"
import {useSettingsOrg} from "./useSettingsOrg"

/** Settings > Audit Log, gated by the plan's audit entitlement and naming users from the roster. */
export const AuditLogTab = ({workspaceId, projectId}: SettingsTabProps) => {
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
            upgradeAvailability={prompt.selfHosted ? SELF_HOSTED_AVAILABILITY : undefined}
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
