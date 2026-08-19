import {useCallback, useState} from "react"

import {traceDrawerClearParams} from "@agenta/observability/traceDrawer"
import {closeTraceDrawerAtom, isDrawerOpenAtom} from "@agenta/observability/traceDrawer"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtomValue, useSetAtom} from "jotai"

import TraceDrawerContent from "./TraceDrawerContent"

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)

    console.log("[trace-drawer] 9 render, open =", open)

    const initialWidth = 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    // Drop the params in the SAME action that closes the drawer, not 320ms later when the slide
    // finishes. `syncTraceStateFromUrl` reopens a closed drawer whenever `?trace=` is still on the
    // URL, so that gap was a window in which any url sync reopened what the user had just closed —
    // close, reopen, close … until the tab locked up. Clearing first leaves nothing to reopen from.
    const handleClose = useCallback(() => {
        console.log("[trace-drawer] 7 onClose")
        traceDrawerClearParams()
        closeDrawer()
    }, [closeDrawer])

    // Backstop for the paths that close the drawer without going through `handleClose` (Escape,
    // outside click). Idempotent: clearing params that are already gone is a no-op push.
    const handleAfterOpenChange = useCallback((isOpen: boolean) => {
        console.log("[trace-drawer] 8 afterOpenChange", isOpen)
        if (!isOpen) traceDrawerClearParams()
    }, [])

    const toggleWidth = useCallback(() => {
        setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
    }, [initialWidth])

    return (
        <EnhancedDrawer
            closable={false}
            title={null}
            open={open}
            onClose={handleClose}
            width={drawerWidth}
            closeOnLayoutClick={false}
            afterOpenChange={handleAfterOpenChange}
            styles={{body: {padding: 0}}}
            destroyOnHidden
        >
            {open && (
                <TraceDrawerContent
                    onClose={handleClose}
                    onToggleWidth={toggleWidth}
                    isExpanded={drawerWidth !== initialWidth}
                />
            )}
        </EnhancedDrawer>
    )
}

export default TraceDrawer
