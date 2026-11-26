import {betaDeveloperModeActiveAtom, projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

const WORKSPACE_IN_PATH = /\/w\/([^/]+)\/p\//

/**
 * The project URL the trace drawer builds its links from, `/w/<workspace>/p/<project>`. Empty
 * outside developer mode, so the drawer keeps its plain labels there. The workspace comes from
 * the address: it changes only with the project, which this atom already reads.
 */
export const traceDrawerProjectURLSourceAtom = atom((get) => {
    const projectId = get(projectIdAtom)
    if (!projectId || !get(betaDeveloperModeActiveAtom) || typeof window === "undefined") return ""
    const workspaceId = WORKSPACE_IN_PATH.exec(window.location.pathname)?.[1]
    return workspaceId ? `/w/${workspaceId}/p/${projectId}` : ""
})
