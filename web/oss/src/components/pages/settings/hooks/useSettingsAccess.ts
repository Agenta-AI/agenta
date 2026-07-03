import {useMemo} from "react"

import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {isBillingEnabled, isEE, isToolsEnabled} from "@/oss/lib/helpers/isEE"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"

import type {SettingsAccess} from "../assets/navigation"

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
            canShowTriggers: isToolsEnabled(),
            canViewApiKeys,
            canViewEvents,
            isEE: isEE(),
            isOwner,
        }),
        [billingEnabled, canViewApiKeys, canViewEvents, isOwner],
    )
}
