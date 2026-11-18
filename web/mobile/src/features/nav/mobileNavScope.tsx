import {useMemo} from "react"

import {SESSIONS_SIDEBAR_KEY} from "@agenta/navigation"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarToggleButton} from "@agenta/navigation-ui"
import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {CreditsRemainingWidget} from "../wallet/CreditsRemainingWidget"

import {DrawerProjectSwitcher} from "./DrawerProjectSwitcher"
import {SupportActions} from "./SupportActions"
import {MOBILE_NAV_SCOPE_ID, useMobileBottomNavItems, useMobileNavItems} from "./useMobileNavItems"
import {usePageArrangement} from "./usePageArrangement"

/**
 * Mobile's scope for the SHARED `SidebarShell` — its header/sections/footer contract. The
 * scope is where mobile's differences live (its item list, its switcher binding); nothing forks.
 *
 * Built per workspace/project, so the slot components and the
 * section hook keep stable identities across renders (a fresh slot type would remount the
 * switcher, and with it the drawer's open popover, on every render).
 */
/** The Prompts developer row's key, as `developerNavItems` builds it (`developer-view-<id>`). */
const PROMPTS_ROW_KEY = "developer-view-prompts"

/**
 * The row an app page belongs to. An app's overview and playground sit under `/apps/<id>`, which
 * the Home row (`/apps`) prefix-matches, but they are not Home: a prompt app is listed under
 * Prompts. Null for every other route, where the route match is right.
 */
export const selectedKeyOverrideFor = (
    pathname: string,
    sessionId: string | null,
    promptsRowShown: boolean,
): string | undefined => {
    if (sessionId) return `${SESSIONS_SIDEBAR_KEY}-${sessionId}`
    // Pinning a row the rail does not render selects nothing, so leave the route match instead.
    if (!promptsRowShown) return undefined
    return /\/apps\/\[app_id\]\/(overview|playground)$/.test(pathname) ? PROMPTS_ROW_KEY : undefined
}

const createMobileNavScope = (workspaceId: string, projectId: string): SidebarScope => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`

    // Pin the open session from the route, the same key its row carries. Its URL is unique
    // (`/sessions/<id>`), so the route match highlights it on its own — but when its agent heading
    // is collapsed, its row leaves the tree and the `/sessions` parent prefix-matches and grabs the
    // highlight. Pinning routes through `resolveSelectedKey`, which selects nothing when the row is
    // not rendered — so a collapse moves the highlight nowhere.
    const useSelection = (): SidebarSelection => {
        const router = useRouter()
        const sessionId =
            typeof router.query.session_id === "string" ? router.query.session_id : null
        const promptsRowShown = useDeveloperViewEnabled("prompts") === true
        const selectedKeyOverride = selectedKeyOverrideFor(
            router.pathname,
            sessionId,
            promptsRowShown,
        )
        return useMemo(
            () => (selectedKeyOverride ? {mode: "route", selectedKeyOverride} : {mode: "route"}),
            [selectedKeyOverride],
        )
    }

    const useSections = (): SidebarSection[] => {
        const {pages, sessions, defaultHidden} = useMobileNavItems(projectURL)
        const {visible, arrange} = usePageArrangement(pages, defaultHidden)
        const bottomItems = useMobileBottomNavItems(projectURL)

        return useMemo(
            () => [
                {key: "pages", items: visible, arrange},
                {key: "sessions", items: [sessions], dividerBefore: true},
                // `vertical`: Help & Docs opens as a flyout, not inline.
                {
                    key: "bottom",
                    items: bottomItems,
                    placement: "bottom",
                    mode: "vertical",
                },
            ],
            [visible, arrange, sessions, bottomItems],
        )
    }

    // The project switcher heads the rail; in the drawer `onDismiss` turns the toggle into a close.
    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => {
        const toggle = <SidebarToggleButton onDismiss={onDismiss} />
        if (collapsed)
            return <div className="flex h-12 shrink-0 items-center justify-center">{toggle}</div>
        return (
            <DrawerProjectSwitcher
                workspaceId={workspaceId}
                projectId={projectId}
                side="bottom"
                trailing={toggle}
            />
        )
    }

    // The icon rail has no room in its header, so the switcher waits at the bottom there.
    const AfterBottom = ({collapsed}: {collapsed: boolean}) =>
        collapsed ? (
            <DrawerProjectSwitcher
                workspaceId={workspaceId}
                projectId={projectId}
                collapsed
                trailing={<SupportActions projectId={projectId} />}
            />
        ) : null

    const Footer = ({collapsed}: SidebarSlotContext) => (
        <CreditsRemainingWidget
            projectId={projectId}
            settingsURL={`${projectURL}/settings`}
            collapsed={collapsed}
        />
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
