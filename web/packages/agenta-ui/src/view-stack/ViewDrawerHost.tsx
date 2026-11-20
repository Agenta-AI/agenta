import {useCallback, useEffect, useRef, useState, type MutableRefObject} from "react"

import {EnhancedDrawer} from "../drawer/EnhancedDrawer"

import {useViewStack} from "./context"
import {DrawerCloseContext, DrawerViewChrome} from "./DrawerViewChrome"
import type {ViewDef, ViewStack, ViewTarget} from "./types"
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
    stackRef: outerStackRef,
}: {
    request: ViewRequest<P>
    /** The stack is empty: the caller drops the request. */
    onClosed: () => void
    width?: number
    /** Receives the drawer's stack, so a later request opens in it. */
    stackRef?: MutableRefObject<ViewStack | null>
}) => {
    const [open, setOpen] = useState(true)
    const ownStackRef = useRef<ViewStack | null>(null)
    const stackRef = outerStackRef ?? ownStackRef
    const close = useCallback(() => {
        void stackRef.current?.closeAll()
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
            // Escape is the stack's: back one level (guarded), and the drawer closes with the
            // stack. The drawer reports Escape only while it is the top layer, so an open menu
            // inside a view takes its own Escape first.
            keyboard={false}
            onEscapeKeyDown={() => void stackRef.current?.back()}
            styles={{body: {padding: 0, display: "flex", flexDirection: "column"}}}
        >
            <DrawerCloseContext.Provider value={close}>
                <ViewStackHost chrome={DrawerViewChrome}>
                    <OpenOnMount
                        request={request as ViewRequest}
                        stackRef={stackRef}
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
    stackRef,
    onEmpty,
}: {
    request: ViewRequest
    stackRef: {current: ViewStack | null}
    onEmpty: () => void
}) => {
    const stack = useViewStack()
    const opened = useRef(false)
    const shown = useRef(false)
    // While the drawer shows a view, a later request opens in this stack; once it is empty the
    // drawer is closing, and the next request gets a new drawer.
    stackRef.current = shown.current && stack.depth === 0 ? null : stack
    useEffect(() => {
        if (opened.current) return
        opened.current = true
        void stack.open(request.view, request.params, request.target)
    }, [stack, request])
    useEffect(() => {
        if (stack.depth > 0) shown.current = true
        else if (shown.current) {
            stackRef.current = null
            onEmpty()
        }
    }, [stack.depth, onEmpty, stackRef])
    return null
}
