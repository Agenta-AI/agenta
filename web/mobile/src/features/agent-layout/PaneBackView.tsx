import {useContext, useEffect, useLayoutEffect, useRef, type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"

import {useSetPaneBack, type PaneBack} from "./paneBack"
import {PanelChromeContext} from "./PanelViewChrome"

const LAYER_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

/** An open view inside a pane tab: while it shows, the pane header is its back link and title. */
export const PaneBackView = ({
    back,
    className,
    children,
}: {
    back: PaneBack
    className?: string
    children: ReactNode
}) => {
    const setBack = useSetPaneBack()
    // The latest handler, so a new function each render does not re-set the header (a loop).
    const onBack = useRef(back.onBack)
    onBack.current = back.onBack
    const {title, current} = back
    useLayoutEffect(() => {
        setBack?.({title, current, onBack: () => onBack.current()})
        return () => setBack?.(null)
    }, [setBack, title, current])
    // Widened for this view: leaving it restores the stored width, as a stack view does.
    const setWide = useContext(PanelChromeContext).widen?.setWide
    useEffect(() => () => setWide?.(false), [setWide])
    // Like a view of the stack: it takes focus when it opens, unless a field inside took it.
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const node = ref.current
        if (node && !node.contains(document.activeElement)) node.focus({preventScroll: true})
    }, [])
    return (
        <div
            ref={ref}
            tabIndex={-1}
            data-pane-view=""
            className={cn("ag-view-enter outline-none", className)}
            // Escape is the header's back link; a menu or dialog inside handles its own first.
            onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented) return
                if ((event.target as HTMLElement).closest?.(LAYER_SELECTOR)) return
                event.preventDefault()
                onBack.current()
            }}
        >
            {children}
        </div>
    )
}
