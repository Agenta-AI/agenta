import {useCallback, useRef, useState, type ReactNode} from "react"

import {useOptionalViewStack} from "./context"
import type {ViewDef, ViewStack, ViewTarget} from "./types"
import {ViewDrawerHost, type ViewRequest} from "./ViewDrawerHost"

// Unique per drawer, so a request after the last drawer emptied mounts a new one.
let lastDrawerKey = 0

/**
 * Opens a view in the nearest container's stack, or, in a host with no stack, in a drawer of its
 * own. Render `drawer` where the drawer may mount. One view, one form, either way.
 */
export const useViewOpener = (): {
    open: <P>(view: ViewDef<P>, params: P, target: ViewTarget) => Promise<boolean>
    drawer: ReactNode
} => {
    const stack = useOptionalViewStack()
    const [request, setRequest] = useState<(ViewRequest & {key: number}) | null>(null)
    // The open drawer's stack: a request while it is open goes through its guarded open.
    const drawerStack = useRef<ViewStack | null>(null)
    const stackOpen = stack?.open
    const open = useCallback(
        <P,>(view: ViewDef<P>, params: P, target: ViewTarget) => {
            if (stackOpen) return stackOpen(view, params, target)
            if (drawerStack.current) return drawerStack.current.open(view, params, target)
            setRequest({view: view as ViewDef<unknown>, params, target, key: ++lastDrawerKey})
            return Promise.resolve(true)
        },
        [stackOpen],
    )
    const drawer = request ? (
        <ViewDrawerHost
            key={request.key}
            request={request}
            stackRef={drawerStack}
            // Only this drawer's own request leaves; a newer one stays.
            onClosed={() => setRequest((current) => (current === request ? null : current))}
        />
    ) : null
    return {open, drawer}
}
