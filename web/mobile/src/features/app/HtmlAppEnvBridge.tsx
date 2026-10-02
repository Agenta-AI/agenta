import {type PropsWithChildren, useMemo} from "react"

import {sharePagePath} from "@agenta/entities/drive"
import {HtmlAppEnvContext} from "@agenta/entity-ui/drive"
import {shareUrl} from "@agenta/sessions/link"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useProjectPermissionState} from "../context/useProjectPermission"

/**
 * Tells the HTML app viewer whether this person may change drive files (write grants, Share), and
 * where this app serves a share link's page.
 */
export const HtmlAppEnvBridge = ({children}: PropsWithChildren) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // Unknown while the check runs: a `false` here would let Run save a lasting read-only grant.
    const canEditMounts = useProjectPermissionState(projectId, "edit_mounts")
    const {basePath} = useRouter()
    const env = useMemo(
        () => ({
            canEditMounts,
            sharePageUrl: (token: string) => shareUrl(`${basePath}${sharePagePath(token)}`),
        }),
        [canEditMounts, basePath],
    )
    return <HtmlAppEnvContext.Provider value={env}>{children}</HtmlAppEnvContext.Provider>
}
