import {useState} from "react"

import {Menu} from "lucide-react"

import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet"

import {NavPanel} from "./NavPanel"

/**
 * The app drawer: mobile's shell over the shared nav model — the SAME `NavPanel` the lg+
 * NavRail docks, inside a sheet. The hamburger hides at lg where the rail takes over, so a
 * viewport never shows both entries to the same nav.
 */
export const NavDrawer = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    const [open, setOpen] = useState(false)
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
            <SheetContent side="left" showCloseButton={false} className="w-[280px] gap-0 p-0">
                {/* Dismissal is tap-outside / swipe — a close X is not a rail affordance. */}
                <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <NavPanel
                    workspaceId={workspaceId}
                    projectId={projectId}
                    onNavigate={() => setOpen(false)}
                />
            </SheetContent>
        </Sheet>
    )
}
