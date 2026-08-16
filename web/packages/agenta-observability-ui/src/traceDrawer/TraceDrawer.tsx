import {useCallback, useState} from "react"

import {traceDrawerClearParams} from "@agenta/observability/traceDrawer"
import {closeTraceDrawerAtom, isDrawerOpenAtom} from "@agenta/observability/traceDrawer"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtomValue, useSetAtom} from "jotai"

import TraceDrawerContent from "./TraceDrawerContent"

const TraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)

    const initialWidth = 1200
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    const handleAfterOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) {
            // clearTraceQueryParam already removes both trace and span params
            traceDrawerClearParams()
        }
    }, [])

    const toggleWidth = useCallback(() => {
        setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
    }, [initialWidth])

    return (
        <EnhancedDrawer
            closable={false}
            title={null}
            open={open}
            onClose={closeDrawer}
            width={drawerWidth}
            closeOnLayoutClick={false}
            afterOpenChange={handleAfterOpenChange}
            styles={{body: {padding: 0}}}
            destroyOnHidden
        >
            {open && (
                <TraceDrawerContent
                    onClose={closeDrawer}
                    onToggleWidth={toggleWidth}
                    isExpanded={drawerWidth !== initialWidth}
                />
            )}
        </EnhancedDrawer>
    )
}

export default TraceDrawer
