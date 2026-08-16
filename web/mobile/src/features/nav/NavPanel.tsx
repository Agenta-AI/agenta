import {useEffect, type MouseEvent} from "react"

import {sidebarOpenGroupsAtomFamily} from "@agenta/navigation"
import {NavMenu} from "@agenta/navigation-ui"
import {useAtom} from "jotai"

import {AgentaLogo} from "@/components/AgentaLogo"

import {DrawerProjectSwitcher} from "./DrawerProjectSwitcher"
import {MOBILE_NAV_SCOPE_ID, useMobileNavItems} from "./useMobileNavItems"

/**
 * The nav panel's CONTENT — logo up top, the shared NavMenu in the middle, the project
 * switcher docked at the bottom. One panel, two mounts: the phone drawer (NavDrawer's sheet)
 * and the persistent lg+ sidebar (NavRail) render exactly this, so the nav model, gated
 * sessions fetch, and open-group persistence stay identical across viewports.
 *
 * Mount-time arming: the gated sources read the open-groups ATOM, not a render fallback —
 * persist the default once on mount (the drawer only mounts this when opened; the rail mounts
 * it with the page, which is exactly when a visible sidebar should start fetching).
 */
export const NavPanel = ({
    workspaceId,
    projectId,
    onNavigate,
}: {
    workspaceId: string
    projectId: string
    /** Called when a navigation link is clicked (the drawer closes itself; the rail doesn't). */
    onNavigate?: () => void
}) => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`
    const items = useMobileNavItems(projectURL)
    const [openGroups, setOpenGroups] = useAtom(sidebarOpenGroupsAtomFamily(MOBILE_NAV_SCOPE_ID))
    const openKeys = openGroups ?? items.filter((item) => item.defaultOpen).map((item) => item.key)
    useEffect(() => {
        if (openGroups === undefined && openKeys.length) setOpenGroups(openKeys)
    }, [openGroups, openKeys, setOpenGroups])

    const toggleKey = (key: string) =>
        setOpenGroups(
            openKeys.includes(key) ? openKeys.filter((open) => open !== key) : [...openKeys, key],
        )

    // Navigation notifies the host; expand toggles and group headers don't.
    const notifyOnNavigate = (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement
        if (target.closest("a")) onNavigate?.()
    }

    return (
        <>
            <div className="px-4 pb-1 pt-4">
                <AgentaLogo className="h-6 w-auto" />
            </div>
            <div className="flex-1 overflow-y-auto py-2" onClick={notifyOnNavigate}>
                <NavMenu
                    items={items}
                    collapsed={false}
                    openKeys={openKeys}
                    onToggleOpenKey={toggleKey}
                />
            </div>
            <div
                className="border-border shrink-0 border-t pb-[env(safe-area-inset-bottom)]"
                onClick={notifyOnNavigate}
            >
                <DrawerProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
            </div>
        </>
    )
}
