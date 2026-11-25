import {useProfile} from "@agenta/entities/profile"
import {AuditLogPage, useEntitlements} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"

import {LockedEnterpriseFeatures} from "./LockedEnterpriseFeatures"
import type {SettingsTabProps} from "./settingsTabProps"
import {useMobileSettingsAccess} from "./settingsTabs"
import {useSettingsOrg} from "./useSettingsOrg"

/** Settings > Audit Log, gated by the plan's audit entitlement and naming users from the roster. */
export const AuditLogTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const access = useMobileSettingsAccess()
    const {user} = useProfile()
    const {org} = useSettingsOrg(workspaceId)
    const entitlements = useEntitlements({projectId, enabled: access.isEE})
    return (
        <AuditLogPage
            hasAudit={entitlements.hasAudit}
            entitlementsLoading={entitlements.isLoading}
            upgradeNotice={
                // Self-hosted gets the Enterprise box; cloud keeps the plan notice.
                isBillingEnabled() ? undefined : (
                    <LockedEnterpriseFeatures features={["audit"]} screen="auditLog" />
                )
            }
            members={org.data?.default_workspace?.members}
            currentUserId={user?.id}
        />
    )
}
