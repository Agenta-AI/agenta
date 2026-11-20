import {useCallback, useState, type ReactNode} from "react"

import {useOptionalViewStack} from "./context"
import type {ViewDef, ViewTarget} from "./types"
import {ViewDrawerHost, type ViewRequest} from "./ViewDrawerHost"

/**
 * Opens a view in the nearest container's stack, or, in a host with no stack, in a drawer of its
 * own. Render `drawer` where the drawer may mount. One view, one form, either way.
 */
export const useViewOpener = (): {
    open: <P>(view: ViewDef<P>, params: P, target: ViewTarget) => Promise<boolean>
    drawer: ReactNode
} => {
    const stack = useOptionalViewStack()
    const [request, setRequest] = useState<ViewRequest | null>(null)
    const stackOpen = stack?.open
    const open = useCallback(
        <P,>(view: ViewDef<P>, params: P, target: ViewTarget) => {
            if (stackOpen) return stackOpen(view, params, target)
            setRequest({view: view as ViewDef<unknown>, params, target})
            return Promise.resolve(true)
        },
        [stackOpen],
    )
    const drawer = request ? (
        <ViewDrawerHost request={request} onClosed={() => setRequest(null)} />
    ) : null
    return {open, drawer}
}
