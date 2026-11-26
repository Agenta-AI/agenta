import {useEffect, useLayoutEffect, useRef, type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"

import {useSetPaneBack, type PaneBack} from "./paneBack"

const LAYER_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

/** An open view inside a pane tab: while it shows, the pane header is its back link. */
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
    const {title} = back
    useLayoutEffect(() => {
        setBack?.({title, onBack: () => onBack.current()})
        return () => setBack?.(null)
    }, [setBack, title])
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
