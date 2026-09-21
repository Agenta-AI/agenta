import {useEffect, useState} from "react"

import type {SidebarScope} from "@agenta/navigation"
import {sidebarOpenGroupsAtomFamily, sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {SidebarShell} from "@agenta/navigation-ui"
import {Button} from "@agenta/ui/ui"
import {ListIcon} from "@phosphor-icons/react"
import {atom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useMobileNavScope} from "./mobileNavScope"

import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet"

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
    const [open, setOpen] = useState(false)
    // The search palette is a dialog of its own, mounted outside this sheet: opening it from the
    // rail inside the sheet closes the sheet, or the pick would land under it.
    const paletteOpen = useAtomValue(sidebarSessionSearchOpenAtom)
    useEffect(() => {
        if (paletteOpen) setOpen(false)
    }, [paletteOpen])
    const mainScope = useMobileNavScope(workspaceId, projectId)
    const scope = scopeOverride ?? mainScope
    const router = useRouter()

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Open navigation"
                    // 20px glyph, not the button's 16: the hamburger is the header's only mark.
                    className="text-muted-foreground relative after:absolute after:-inset-1.5 after:content-[''] lg:hidden [&_svg:not([class*='size-'])]:size-5"
                >
                    <ListIcon />
                </Button>
            </SheetTrigger>
            <SheetContent side="left" showCloseButton={false} className="w-[236px] gap-0 p-0">
                {/* The sheet's own X is off: the rail's header already has the button, and
                    `onDismiss` turns it into this sheet's close. */}
                <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <SidebarShell
                    key={scope.id}
                    collapsedAtom={drawerExpandedAtom}
                    currentPath={router.asPath}
                    openGroupsAtomFamily={sidebarOpenGroupsAtomFamily}
                    scope={scope}
                    onNavigate={() => setOpen(false)}
                    onDismiss={() => setOpen(false)}
                />
            </SheetContent>
        </Sheet>
    )
}
