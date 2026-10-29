import type {SidebarScope} from "@agenta/navigation"
import {sidebarCollapsedAtom, sidebarOpenGroupsAtomFamily} from "@agenta/navigation"
import {SidebarShell} from "@agenta/navigation-ui"
import {useRouter} from "next/router"

import {useMobileNavScope} from "./mobileNavScope"

/**
 * The persistent lg+ sidebar — the DESKTOP rail component, docked. Hidden below lg, where the
 * same shell lives inside the NavDrawer sheet instead; the two share one nav model, one
 * open-groups bucket and one collapsed state, so the rail and the drawer never drift.
 *
 * `scope` overrides the main nav where a screen takes the rail over (settings). Keyed on the
 * scope id: the two scopes call different hooks, so the shell has to remount between them.
 */
export const NavRail = ({
    workspaceId,
    projectId,
    scope: scopeOverride,
}: {
    workspaceId: string
    projectId: string
    scope?: SidebarScope
}) => {
    const mainScope = useMobileNavScope(workspaceId, projectId)
    const scope = scopeOverride ?? mainScope
    const router = useRouter()

    return (
        <SidebarShell
            key={scope.id}
            collapsedAtom={sidebarCollapsedAtom}
            currentPath={router.asPath}
            openGroupsAtomFamily={sidebarOpenGroupsAtomFamily}
            scope={scope}
            className="hidden shrink-0 lg:block"
        />
    )
}
