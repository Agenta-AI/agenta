import {type PropsWithChildren, useMemo} from "react"

import {HtmlAppEnvContext} from "@agenta/entity-ui/drive"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

/** Tells the HTML app viewer whether this person may change drive files (write grants, Share). */
export const HtmlAppEnvBridge = ({children}: PropsWithChildren) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canEditMounts = useProjectPermission(projectId, "edit_mounts")
    const env = useMemo(() => ({canEditMounts}), [canEditMounts])
    return <HtmlAppEnvContext.Provider value={env}>{children}</HtmlAppEnvContext.Provider>
}
