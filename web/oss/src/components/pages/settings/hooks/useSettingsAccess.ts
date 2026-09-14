import {useMemo} from "react"

import type {SettingsAccess} from "@agenta/settings"
import {isBillingEnabled, isEE, isToolsEnabled} from "@agenta/shared/api"

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

    return useMemo(
        () => ({
            billingEnabled,
            canShowTools: isToolsEnabled(),
            // The deployment flag arrives with the feature-flag PR up the stack.
            canShowChannels: true,
            canViewApiKeys,
            canViewEvents,
            isEE: isEE(),
            isOwner,
        }),
        [billingEnabled, canViewApiKeys, canViewEvents, isOwner],
    )
}
