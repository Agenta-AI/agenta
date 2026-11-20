import {useCallback, useEffect, useRef, useState} from "react"

import {EnhancedDrawer} from "../drawer/EnhancedDrawer"

import {useViewStack} from "./context"
import {DrawerCloseContext, DrawerViewChrome} from "./DrawerViewChrome"
import type {ViewDef, ViewTarget} from "./types"
import {ViewStackHost} from "./ViewStackHost"

/** One view to show, with the target it writes. */
export interface ViewRequest<P = unknown> {
    view: ViewDef<P>
    params: P
    target: ViewTarget
}

/** Today's drawer widths: a wide view (an editor) and the rest. */
const WIDE_WIDTH = 920
const WIDTH = 580

/**
 * A container that keeps a drawer: one view stack inside a drawer shell, opened on `request`.
 * The drawer closes when the stack is empty again (Done, Save, Cancel or back from depth 1), and
 * its own close (outside click, Close) leaves through the stack's guard.
 */
export const ViewDrawerHost = <P,>({
    request,
    onClosed,
    width,
}: {
    request: ViewRequest<P>
    /** The stack is empty: the caller drops the request. */
    onClosed: () => void
    width?: number
}) => {
    const [open, setOpen] = useState(true)
    const closeAllRef = useRef<(() => Promise<boolean>) | null>(null)
    const close = useCallback(() => {
        void closeAllRef.current?.()
    }, [])
    const finish = useCallback(() => setOpen(false), [])
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={close}
            afterOpenChange={(next) => {
                if (!next) onClosed()
            }}
            placement="right"
            width={width ?? (request.view.wide ? WIDE_WIDTH : WIDTH)}
            closable={false}
            // The stack handles Escape: back one level, then the drawer closes with the stack.
            keyboard={false}
            styles={{body: {padding: 0, display: "flex", flexDirection: "column"}}}
        >
            <DrawerCloseContext.Provider value={close}>
                <ViewStackHost chrome={DrawerViewChrome}>
                    <OpenOnMount
                        request={request as ViewRequest}
                        closeAllRef={closeAllRef}
                        onEmpty={finish}
                    />
                </ViewStackHost>
            </DrawerCloseContext.Provider>
        </EnhancedDrawer>
    )
}

/** The stack's root: opens the requested view once, and reports when the stack is empty again. */
const OpenOnMount = ({
    request,
    closeAllRef,
    onEmpty,
}: {
    request: ViewRequest
    closeAllRef: {current: (() => Promise<boolean>) | null}
    onEmpty: () => void
}) => {
    const stack = useViewStack()
    closeAllRef.current = stack.closeAll
    const opened = useRef(false)
    const shown = useRef(false)
    useEffect(() => {
        if (opened.current) return
        opened.current = true
        void stack.open(request.view, request.params, request.target)
    }, [stack, request])
    useEffect(() => {
        if (stack.depth > 0) shown.current = true
        else if (shown.current) onEmpty()
    }, [stack.depth, onEmpty])
    return null
}
