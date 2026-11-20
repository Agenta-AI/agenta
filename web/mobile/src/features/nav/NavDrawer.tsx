import {useEffect, useState} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import phoneCatalog from "@agenta/i18n/catalogs/ui.phone"
import type {SidebarScope} from "@agenta/navigation"
import {sidebarOpenGroupsAtomFamily, sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {SidebarLayoutContext, SidebarShell} from "@agenta/navigation-ui"
import {SidebarSheet, useIsPhone} from "@agenta/ui/phone"
import {Button, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from "@agenta/ui/ui"
import {ListIcon} from "@phosphor-icons/react"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {liveChatOpenAtom} from "../support/crispChat"

import {useRailScope} from "./railScope"

/**
 * The drawer is never collapsed. `sidebarCollapsedAtom` is persisted per origin, which `/m`
 * shares with the desktop app — a rail collapsed there would otherwise open here as a 48px
 * icon strip inside a 236px sheet, with no toggle on this viewport to undo it.
 */
const drawerExpandedAtom = atom(false)

/**
 * The app drawer: the SAME `SidebarShell` the lg+ NavRail docks, inside a sheet sized to the
 * rail's own width. The hamburger hides at lg where the rail takes over, so a viewport never
 * shows both entries to the same nav.
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
    // A phone gets the 300 px sidebar sheet with 44 px rows; wider windows keep the rail's sheet.
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

    if (phone) {
        return (
            <>
                {/* The sidebar brings its own Back and Close row (onDismiss), so the sheet draws
                    none. */}
                <SidebarSheet
                    open={open}
                    onOpenChange={setOpen}
                    title={t("navigation.chrome.navigationTitle")}
                    showHeader={false}
                    trigger={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tPhone("ui.phone.openSidebar")}
                            className="text-muted-foreground relative after:absolute after:-inset-1.5 after:content-[''] [&_svg:not([class*='size-'])]:size-5"
                        >
                            <ListIcon />
                        </Button>
                    }
                    // Every small button and link of the sidebar (group +, row ⋯, search, help) is 44 x 44 px
                    // here, so a finger reaches it; the icons keep their size.
                    className="[&_a]:min-h-11 [&_a]:min-w-11 [&_button]:min-h-11 [&_button]:min-w-11"
                >
                    <SidebarLayoutContext.Provider value="phone">
                        {shell}
                    </SidebarLayoutContext.Provider>
                </SidebarSheet>
            </>
        )
    }

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("navigation.chrome.openNavigation")}
                    // 20px glyph, not the button's 16: the hamburger is the header's only mark.
                    className="text-muted-foreground relative after:absolute after:-inset-1.5 after:content-[''] lg:hidden [&_svg:not([class*='size-'])]:size-5"
                >
                    <ListIcon />
                </Button>
            </SheetTrigger>
            {/* Flush to the viewport's left edge, unlike the kit's floating panel: a nav drawer
                reads as the rail sliding in, so only its open side is rounded. */}
            <SheetContent
                side="left"
                className="inset-y-0 left-0 w-[236px] gap-0 rounded-none rounded-r-xl p-0"
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
