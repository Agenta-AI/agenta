import {useCallback, useEffect, useState} from "react"

import {
    isSecurityWarningSnoozed,
    securityReleaseAtom,
    snoozeSecurityWarning,
    type Release,
} from "@agenta/navigation"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

/**
 * The newest security release this instance is below, for organization owners and admins
 * (the default roles that may change roles, as on the members screen), unless they closed the
 * warning in the last seven days. Never on cloud.
 */
export const useSecurityWarning = (): {release: Release | null; snooze: () => void} => {
    const release = useAtomValue(securityReleaseAtom)
    const projectId = useAtomValue(projectIdAtom)
    // No release, no permission request.
    const canManage = useProjectPermission(release ? (projectId ?? "") : "", "modify_user_roles")

    // Start snoozed: localStorage is not readable during the server render.
    const [snoozed, setSnoozed] = useState(true)
    useEffect(() => {
        setSnoozed(release ? isSecurityWarningSnoozed(release.id) : true)
    }, [release])

    const snooze = useCallback(() => {
        if (release) snoozeSecurityWarning(release.id)
        setSnoozed(true)
    }, [release])

    return {release: release && canManage && !snoozed ? release : null, snooze}
}
