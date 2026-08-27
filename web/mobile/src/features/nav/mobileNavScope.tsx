import {useMemo} from "react"

import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarBanners, SidebarLogo, SidebarToggleButton} from "@agenta/navigation-ui"

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
                    mode: "vertical",
                },
            ],
            [items, bottomItems],
        )
    }

    // Docked at lg+, so it carries the desktop's collapse toggle; in the drawer `onDismiss`
    // arrives and the same button becomes the sheet's close.
    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => (
        <SidebarLogo collapsed={collapsed} toggle={<SidebarToggleButton onDismiss={onDismiss} />} />
    )

    const AfterBottom = () => (
        <DrawerProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
    )

    // Same slot the desktop rail fills, and hidden while collapsed for the same reason: the
    // card has no 48px form. The drawer is never collapsed, so it always shows there.
    const Footer = ({collapsed}: {collapsed: boolean}) =>
        collapsed ? null : (
            <div className="w-full">
                <SidebarBanners />
            </div>
        )

    return {
        id: MOBILE_NAV_SCOPE_ID,
        useSelection,
        useSections,
        header: Header,
        footer: Footer,
        afterBottom: AfterBottom,
    }
}

export const useMobileNavScope = (workspaceId: string, projectId: string) =>
    useMemo(() => createMobileNavScope(workspaceId, projectId), [workspaceId, projectId])
