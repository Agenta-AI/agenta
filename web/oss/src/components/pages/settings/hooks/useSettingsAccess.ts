import {useMemo} from "react"

import type {SettingsAccess} from "@agenta/settings"
import {isBillingEnabled, isEE, isMcpGatewayEnabled, isToolsEnabled} from "@agenta/shared/api"

import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"

/** This app's edition/permission flags, fed to `SettingsAccessProvider`. */
export const useSettingsAccess = (): SettingsAccess => {
    const {selectedOrg} = useOrgData()
    const {user} = useProfileData()
    const {canViewApiKeys, canViewEvents} = useProjectPermissions()
    const isOwner = !!selectedOrg?.owner_id && selectedOrg.owner_id === user?.id
    const billingEnabled = isBillingEnabled()
    const mcpGatewayEnabled = isMcpGatewayEnabled()

    return useMemo(
        () => ({
            billingEnabled,
            canShowMcpEndpoints: mcpGatewayEnabled,
            canShowTools: isToolsEnabled(),
            canViewApiKeys,
            canViewEvents,
            isEE: isEE(),
            isOwner,
        }),
        [billingEnabled, mcpGatewayEnabled, canViewApiKeys, canViewEvents, isOwner],
    )
}
