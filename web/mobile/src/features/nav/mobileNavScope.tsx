import {useMemo} from "react"

import type {SidebarScope, SidebarSection, SidebarSelection} from "@agenta/navigation"
import {SidebarLogo} from "@agenta/navigation-ui"

import {DrawerProjectSwitcher} from "./DrawerProjectSwitcher"
import {MOBILE_NAV_SCOPE_ID, useMobileBottomNavItems, useMobileNavItems} from "./useMobileNavItems"

/**
 * Mobile's scope for the SHARED `SidebarShell` — the same header/sections/footer contract the
 * desktop rail fills, so both apps render one rail component with one geometry. The scope is
 * where mobile's differences live (its item list, its switcher binding); nothing forks.
 *
 * Built per workspace/project like the desktop's `create()`, so the slot components and the
 * section hook keep stable identities across renders (a fresh slot type would remount the
 * switcher, and with it the drawer's open popover, on every render).
 */
const createMobileNavScope = (workspaceId: string, projectId: string): SidebarScope => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`

    const useSelection = (): SidebarSelection => ({mode: "route"})

    const useSections = (): SidebarSection[] => {
        const items = useMobileNavItems(projectURL)
        const bottomItems = useMobileBottomNavItems(projectURL)

        return useMemo(
            () => [
                {key: "project", items},
                // `vertical` mirrors the desktop rail: Help & Docs opens as a flyout, not inline.
                {
                    key: "bottom",
                    items: bottomItems,
                    placement: "bottom",
                    dividerBefore: true,
                    mode: "vertical",
                },
            ],
            [items, bottomItems],
        )
    }

    const AfterBottom = () => (
        <DrawerProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
    )

    return {
        id: MOBILE_NAV_SCOPE_ID,
        useSelection,
        useSections,
        header: SidebarLogo,
        afterBottom: AfterBottom,
    }
}

export const useMobileNavScope = (workspaceId: string, projectId: string) =>
    useMemo(() => createMobileNavScope(workspaceId, projectId), [workspaceId, projectId])
