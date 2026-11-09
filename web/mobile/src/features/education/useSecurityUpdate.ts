import {useCallback, useEffect, useState} from "react"

import {
    dismissSecurityWarning,
    isSecurityWarningDismissed,
    latestSecurityRelease,
    releaseListAtom,
    runningVersionAtom,
    type Release,
} from "@agenta/navigation"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

/**
 * The newest security release this instance is below, for organization owners and admins
 * (the default roles that may change roles), unless they closed it in the last seven days.
 */
export const useSecurityUpdate = (): {release: Release | null; dismiss: () => void} => {
    const release = latestSecurityRelease(
        useAtomValue(releaseListAtom),
        useAtomValue(runningVersionAtom),
    )
    const projectId = useAtomValue(projectIdAtom)
    // No release, no permission request.
    const canManage = useProjectPermission(release ? (projectId ?? "") : "", "modify_user_roles")

    // Start dismissed: localStorage is not readable during the server render.
    const [dismissed, setDismissed] = useState(true)
    useEffect(() => {
        setDismissed(release ? isSecurityWarningDismissed(release.id) : true)
    }, [release])

    const dismiss = useCallback(() => {
        if (release) dismissSecurityWarning(release.id)
        setDismissed(true)
    }, [release])

    return {release: release && canManage && !dismissed ? release : null, dismiss}
}
