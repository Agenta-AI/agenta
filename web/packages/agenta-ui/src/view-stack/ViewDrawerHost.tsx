import {useCallback, useEffect, useRef, useState, type MutableRefObject} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"

import {Dialog, DialogContent, DialogTitle} from "../components/ui/dialog"
import {Sheet, SheetContent, SheetTitle} from "../components/ui/sheet"
import {useIsPhone} from "../phone/useIsPhone"

import {useViewStack} from "./context"
import {DrawerBareContext, DrawerCloseContext, DrawerViewChrome} from "./DrawerViewChrome"
import {PhoneViewChrome} from "./PhoneViewChrome"
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
/** A dialog's width, as the forms' modals before the view stack. */
const DIALOG_WIDTH = 520

/**
 * A container that keeps a drawer: one view stack inside a drawer shell, opened on `request`.
 * The drawer closes when the stack is empty again (Done, Save, Cancel or back from depth 1), and
 * its own close (outside click, Close) leaves through the stack's guard.
 */
export const ViewDrawerHost = <P,>({
    request,
    onClosed,
    width,
    title,
    stackRef: outerStackRef,
    presentation = "drawer",
    bare = false,
}: {
    request: ViewRequest<P>
    /** The stack is empty: the caller drops the request. */
    onClosed: () => void
    width?: number
    /** The dialog's accessible name, e.g. the item's name; falls back to "Dialog". */
    title?: string
    /** Receives the drawer's stack, so a later request opens in it. */
    stackRef?: MutableRefObject<ViewStack | null>
    /** `dialog`: a centred modal on wide screens; a phone still covers the screen. */
    presentation?: "drawer" | "dialog"
    /** No header row: for a view that heads itself (a logo and a title); Close moves beside it. */
    bare?: boolean
}) => {
    const t = useT(commonCatalog)
    const [open, setOpen] = useState(true)
    // On a phone the drawer covers the screen with the phone chrome (back arrow, 44 px buttons)
    // and follows the phone rules (read-only views).
    const phone = useIsPhone()
    const ownStackRef = useRef<ViewStack | null>(null)
    const stackRef = outerStackRef ?? ownStackRef
    const close = useCallback(() => {
        void stackRef.current?.closeAll()
    }, [])
    const finish = useCallback(() => setOpen(false), [])
    const body = (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-0 text-field-md text-foreground">
            <DrawerCloseContext.Provider value={close}>
                <DrawerBareContext.Provider value={bare && !phone}>
                <ViewStackHost
                    chrome={phone ? PhoneViewChrome : DrawerViewChrome}
                    phone={phone}
                    confirmLeave={presentation !== "dialog"}
                >
                    <OpenOnMount
                        request={request as ViewRequest}
                        stackRef={stackRef}
                        onEmpty={finish}
                    />
                </ViewStackHost>
                </DrawerBareContext.Provider>
            </DrawerCloseContext.Provider>
        </div>
    )
    if (presentation === "dialog" && !phone) {
        return (
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!next) close()
                }}
            >
                <DialogContent
                    showCloseButton={false}
                    className="max-h-[min(760px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0"
                    style={{maxWidth: width ?? DIALOG_WIDTH}}
                    onOpenAutoFocus={(e) => {
                        if (
                            (e.currentTarget as HTMLElement | null)?.contains(
                                document.activeElement,
                            )
                        )
                            e.preventDefault()
                    }}
                    onCloseAutoFocus={() => onClosed()}
                    // Escape is the stack's, as in the drawer.
                    onEscapeKeyDown={(e) => {
                        e.preventDefault()
                        void stackRef.current?.back()
                    }}
                >
                    <DialogTitle className="sr-only">{title || t("common.dialog")}</DialogTitle>
                    {body}
                </DialogContent>
            </Dialog>
        )
    }
    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) close()
            }}
        >
            <SheetContent
                side="right"
                className="ag-drawer-elevated"
                style={
                    phone
                        ? {
                              inset: 0,
                              width: "100%",
                              maxWidth: "100%",
                              borderRadius: 0,
                              // Clear of the notch and the home bar, as the Channels connect layer.
                              paddingTop: "env(safe-area-inset-top)",
                              paddingBottom: "env(safe-area-inset-bottom)",
                          }
                        : {
                              width: width ?? (request.view.wide ? WIDE_WIDTH : WIDTH),
                              maxWidth: "calc(100% - 1rem)",
                          }
                }
                // A control that focused itself on mount keeps focus.
                onOpenAutoFocus={(e) => {
                    if ((e.currentTarget as HTMLElement | null)?.contains(document.activeElement))
                        e.preventDefault()
                }}
                onCloseAutoFocus={() => onClosed()}
                // Escape is the stack's: back one level (guarded), and the drawer closes with the
                // stack. Radix reports Escape only while the drawer is the top layer.
                onEscapeKeyDown={(e) => {
                    e.preventDefault()
                    void stackRef.current?.back()
                }}
            >
                <SheetTitle className="sr-only">{title || t("common.dialog")}</SheetTitle>
                {body}
            </SheetContent>
        </Sheet>
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
