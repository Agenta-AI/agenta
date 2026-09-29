import {type PropsWithChildren, useMemo} from "react"

import {sharePagePath} from "@agenta/entities/drive"
import {HtmlAppEnvContext} from "@agenta/entity-ui/drive"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useProjectPermission} from "../context/useProjectPermission"

/**
 * Tells the HTML app viewer whether this person may change drive files (write grants, Share), and
 * where this app serves a share link's page.
 */
export const HtmlAppEnvBridge = ({children}: PropsWithChildren) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canEditMounts = useProjectPermission(projectId, "edit_mounts")
    const {basePath} = useRouter()
    const env = useMemo(
        () => ({
            canEditMounts,
            sharePageUrl: (token: string) =>
                new URL(`${basePath}${sharePagePath(token)}`, window.location.origin).toString(),
        }),
        [canEditMounts, basePath],
    )
    return <HtmlAppEnvContext.Provider value={env}>{children}</HtmlAppEnvContext.Provider>
}
