import {useCallback, useState} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {traceDrawerClearParams} from "@agenta/observability/traceDrawer"
import {
    closeTraceDrawerAtom,
    isDrawerOpenAtom,
    traceDrawerTraceIdAtom,
} from "@agenta/observability/traceDrawer"
import {Sheet, SheetContent, SheetTitle} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {deleteTraceModalAtom} from "../delete/store/atom"

import type {TraceDrawerLayout} from "./TraceDrawerContent"
import TraceDrawerContentSkeleton from "./TraceDrawerContentSkeleton"

// The body loads on the first open, so a host that mounts the drawer on every page carries only
// the panel. The panel opens at once and shows the skeleton until the body arrives.
const TraceDrawerContent = dynamic(() => import("./TraceDrawerContent"), {
    ssr: false,
    loading: TraceDrawerContentSkeleton,
})

// The one trace-delete confirmation for the app; it loads on the first delete.
const DeleteTraceModal = dynamic(() => import("../delete"), {ssr: false})

interface TraceDrawerProps {
    /**
     * `split` (default): the span tree beside the span content, sized for a desktop drawer.
     * `stacked`: the tree above the content, both at the panel's width, for a phone-width host
     * (`web/mobile`). The split columns need at least 720px, so on a phone they scrolled sideways.
     */
    layout?: TraceDrawerLayout
}

const TraceDrawer = ({layout = "split"}: TraceDrawerProps) => {
    const t = useT(drawerCatalog)
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const traceId = useAtomValue(traceDrawerTraceIdAtom)
    const deleteOpen = useAtomValue(deleteTraceModalAtom).isOpen
    // Stays mounted after the first open so the dialog can animate closed.
    const [deleteLoaded, setDeleteLoaded] = useState(false)
    if (deleteOpen && !deleteLoaded) setDeleteLoaded(true)

    const initialWidth = 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    // Drop the params in the SAME action that closes the drawer, not 320ms later when the slide
    // finishes. `syncTraceStateFromUrl` reopens a closed drawer whenever `?trace=` is still on the
    // URL, so that gap was a window in which any url sync reopened what the user had just closed —
    // close, reopen, close … until the tab locked up. Clearing first leaves nothing to reopen from.
    const handleClose = useCallback(() => {
        traceDrawerClearParams()
        closeDrawer()
    }, [closeDrawer])

    // Backstop for closes that skip `handleClose`; runs once the panel has slid out.
    const handleAfterClose = useCallback(() => {
        traceDrawerClearParams()
    }, [])

    const toggleWidth = useCallback(() => {
        setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
    }, [initialWidth])

    return (
        <>
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) handleClose()
                }}
            >
                <SheetContent
                    side="right"
                    style={{width: drawerWidth, maxWidth: "calc(100% - 1rem)"}}
                    onCloseAutoFocus={handleAfterClose}
                >
                    <SheetTitle className="sr-only">
                        {t("observabilityUi.traceDrawer.trace")}
                    </SheetTitle>
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-[inherit] p-0 text-field-md text-foreground">
                        {open && (
                            <TraceDrawerContent
                                onClose={handleClose}
                                onToggleWidth={toggleWidth}
                                isExpanded={drawerWidth !== initialWidth}
                                layout={layout}
                            />
                        )}
                    </div>
                </SheetContent>
            </Sheet>
            {deleteLoaded ? (
                <DeleteTraceModal openTraceId={open ? traceId : null} onDrawerClose={handleClose} />
            ) : null}
        </>
    )
}

export default TraceDrawer
