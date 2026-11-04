import {useBindWorkspaceMembers} from "./useBindWorkspaceMembers"

/**
 * Binds the workspace members while the trace drawer is open, so the drawer names annotation
 * authors. `GlobalDrawers` loads it on demand and mounts it only with the drawer open.
 */
export const TraceDrawerMembers = () => {
    useBindWorkspaceMembers()
    return null
}

export default TraceDrawerMembers
