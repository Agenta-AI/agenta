import {useBindWorkspaceMembers} from "../members/useBindWorkspaceMembers"

/** Loads the workspace members so every "Created by" on the page shows a name. Renders nothing. */
export const BindWorkspaceMembers = () => {
    useBindWorkspaceMembers()
    return null
}
