import {useEffect, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import type {SidebarScope} from "@agenta/navigation"
import {sidebarOpenGroupsAtomFamily, sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {SidebarLayoutContext, SidebarShell} from "@agenta/navigation-ui"
import {SidebarSheet, useIsPhone} from "@agenta/ui/phone"
import {
    Button,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {EqualsIcon} from "@phosphor-icons/react"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {
    currentSidebar,
    openAgentSidebar,
    type SelectedSidebar,
} from "../agent-sidebar/selectedSidebar"
import {usePageAgentId} from "../agent-sidebar/useAgentSidebarSync"
import {liveChatOpenAtom} from "../support/crispChat"

import {useRailScope} from "./railScope"

/**
 * The drawer is never collapsed. `sidebarCollapsedAtom` is persisted per origin, which `/m`
 * shares with the desktop app — a rail collapsed there would otherwise open here as a 48px
 * icon strip inside a 236px sheet, with no toggle on this viewport to undo it.
 */
const drawerExpandedAtom = atom(false)

/** The agent's sidebar, unless the tab already shows an agent sidebar. */
const showAgentSidebar = (agentId: string) => {
    if (currentSidebar().kind === "main") openAgentSidebar(agentId, "main")
}

/**
 * The app drawer: the SAME `SidebarShell` the lg+ NavRail docks, inside a sheet. On a phone it
 * is the phone sidebar sheet, with the rail's own row sizes (SIZE-02); up to lg it is sized to
 * the rail's own width. The hamburger hides at lg where the rail takes over, so a viewport never shows both
 * entries to the same nav.
 */
export const NavDrawer = ({
    workspaceId,
    projectId,
    scope: scopeOverride,
}: {
    workspaceId: string
    projectId: string
    /** Replaces the main nav where a screen takes the rail over (settings). */
    scope?: SidebarScope
}) => {
    const t = useT(navigationCatalog)
    const tPhone = useT(phoneCatalog)
    const [open, setOpen] = useState(false)
    // A phone gets the phone sidebar sheet; wider windows keep the rail's sheet.
    const phone = useIsPhone()
    // The search palette is a dialog of its own, mounted outside this sheet: opening it from the
    // rail inside the sheet closes the sheet, or the pick would land under it.
    const paletteOpen = useAtomValue(sidebarSessionSearchOpenAtom)
    useEffect(() => {
        if (paletteOpen) setOpen(false)
    }, [paletteOpen])
    // Same for the live chat: this modal sheet would make Crisp's window inert.
    const liveChatOpen = useAtomValue(liveChatOpenAtom)
    useEffect(() => {
        if (liveChatOpen) setOpen(false)
    }, [liveChatOpen])
    // On a phone the menu button inside an agent opens that agent's sidebar. "Back" in the sheet
    // shows the main sidebar; the next tap on the menu inside an agent shows the agent's again.
    // A screen with its own rail keeps it.
    const pageAgentId = usePageAgentId(projectId)
    const agentSheet = phone && !scopeOverride
    // The menu opened before the session's agent was known (its row still loading): the sidebar
    // shown then. The agent's sidebar follows when the agent arrives, unless the person picked
    // another sidebar meanwhile (Back, a switcher pick) or closed the sheet.
    const waitingFor = useRef<SelectedSidebar | null>(null)
    const onOpenChange = (next: boolean) => {
        if (next && agentSheet) {
            if (pageAgentId) showAgentSidebar(pageAgentId)
            else waitingFor.current = currentSidebar()
        }
        setOpen(next)
    }
    useEffect(() => {
        if (!open) waitingFor.current = null
        if (!open || !waitingFor.current || !pageAgentId) return
        const shown = waitingFor.current
        waitingFor.current = null
        if (currentSidebar() === shown) showAgentSidebar(pageAgentId)
    }, [open, pageAgentId])
    useEffect(() => {
        // Fetch the agent sidebar's code ahead of the tap, so it is cached when the sheet opens.
        if (agentSheet && pageAgentId) void import("../agent-sidebar/agentSidebarScope")
    }, [agentSheet, pageAgentId])
    const scope = useRailScope(workspaceId, projectId, scopeOverride)
    const router = useRouter()
    // A pick in a rail flyout navigates from a button, which the shell's link-click close misses.
    useEffect(() => {
        setOpen(false)
    }, [router.asPath])

    const shell = (
        <SidebarShell
            key={scope.id}
            collapsedAtom={drawerExpandedAtom}
            currentPath={router.asPath}
            openGroupsAtomFamily={sidebarOpenGroupsAtomFamily}
            scope={scope}
            onNavigate={() => setOpen(false)}
            onDismiss={() => setOpen(false)}
        />
    )

    const menuButton = (label: string) => (
        <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            aria-label={label}
            className="relative lg:hidden"
        >
            <EqualsIcon aria-hidden />
        </Button>
    )

    if (phone) {
        // The sidebar brings its own Back and Close row (onDismiss), so the sheet draws none.
        return (
            <SidebarSheet
                open={open}
                onOpenChange={onOpenChange}
                title={t("navigation.chrome.navigationTitle")}
                showHeader={false}
                trigger={menuButton(tPhone("ui.phone.openSidebar"))}
            >
                <SidebarLayoutContext.Provider value="phone">{shell}</SidebarLayoutContext.Provider>
            </SidebarSheet>
        )
    }

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SimpleTooltip title={t("navigation.chrome.openNavigation")}>
                <span className="inline-flex lg:hidden">
                    <SheetTrigger asChild>
                        {menuButton(t("navigation.chrome.openNavigation"))}
                    </SheetTrigger>
                </span>
            </SimpleTooltip>
            {/* Flush to the viewport's left edge, unlike the kit's floating panel: a nav drawer
                reads as the rail sliding in, so only its open side is rounded. */}
            <SheetContent
                side="left"
                className="inset-y-0 left-0 w-60 gap-0 rounded-none rounded-r-xl p-0"
            >
                {/* The sheet's own X is off: the rail's header already has the button, and
                    `onDismiss` turns it into this sheet's close. */}
                <SheetHeader className="sr-only" showCloseButton={false}>
                    <SheetTitle>{t("navigation.chrome.navigationTitle")}</SheetTitle>
                </SheetHeader>
                {shell}
            </SheetContent>
        </Sheet>
    )
}
