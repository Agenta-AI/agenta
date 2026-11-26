import {useLayoutEffect, useRef, type ReactNode} from "react"

import {cn} from "@agenta/ui/styles"

import {useSetPaneBack, type PaneBack} from "./paneBack"

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
    return <div className={cn("ag-view-enter", className)}>{children}</div>
}
