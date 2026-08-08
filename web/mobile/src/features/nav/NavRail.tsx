import {sidebarCollapsedAtom, sidebarOpenGroupsAtomFamily} from "@agenta/navigation"
import {SidebarShell} from "@agenta/navigation-ui"
import {useRouter} from "next/router"

import {useMobileNavScope} from "./mobileNavScope"

/**
 * The persistent lg+ sidebar — the DESKTOP rail component, docked. Hidden below lg, where the
 * same shell lives inside the NavDrawer sheet instead; the two share one nav model, one
 * open-groups bucket and one collapsed state, so the rail and the drawer never drift.
 */
export const NavRail = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    const scope = useMobileNavScope(workspaceId, projectId)
    const router = useRouter()

    return (
        <SidebarShell
            collapsedAtom={sidebarCollapsedAtom}
            currentPath={router.asPath}
            openGroupsAtomFamily={sidebarOpenGroupsAtomFamily}
            scope={scope}
            className="hidden shrink-0 lg:block"
        />
    )
}
