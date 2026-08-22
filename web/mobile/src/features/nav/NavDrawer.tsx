import {useState} from "react"

import type {SidebarScope} from "@agenta/navigation"
import {sidebarOpenGroupsAtomFamily} from "@agenta/navigation"
import {SidebarShell} from "@agenta/navigation-ui"
import {atom} from "jotai"
import {Menu} from "lucide-react"
import {useRouter} from "next/router"

import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet"

import {useMobileNavScope} from "./mobileNavScope"

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
    const mainScope = useMobileNavScope(workspaceId, projectId)
    const scope = scopeOverride ?? mainScope
    const router = useRouter()

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <button
                    type="button"
                    aria-label="Open navigation"
                    className="text-muted-foreground relative flex size-8 shrink-0 items-center justify-center after:absolute after:-inset-1.5 after:content-[''] lg:hidden"
                >
                    <Menu size={20} />
                </button>
            </SheetTrigger>
            <SheetContent side="left" showCloseButton={false} className="w-[236px] gap-0 p-0">
                {/* Dismissal is tap-outside / swipe — a close X is not a rail affordance. */}
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
                />
            </SheetContent>
        </Sheet>
    )
}
