import {
    type PointerEvent as ReactPointerEvent,
    type RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
} from "react"

import {useAtom} from "jotai"

import {clampSidebarWidth, sidebarWidthAtom} from "@/oss/lib/atoms/sidebar"

interface DragState {
    pointerId: number
    startX: number
    startWidth: number
    width: number
}

interface UseSidebarResizeParams {
    /** The rail element that owns `--ag-sidebar-w`; the drag repaints it directly. */
    railRef: RefObject<HTMLDivElement | null>
    disabled: boolean
}

/**
 * Drag-to-resize for the expanded rail. The live width is painted onto the rail's CSS
 * variable inside a rAF, so a drag costs zero React renders; the atom is written once on
 * release.
 */
export const useSidebarResize = ({railRef, disabled}: UseSidebarResizeParams) => {
    const [width, setWidth] = useAtom(sidebarWidthAtom)
    const dragRef = useRef<DragState | null>(null)
    const frameRef = useRef<number | null>(null)

    const cancelFrame = useCallback(() => {
        if (frameRef.current === null) return
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
    }, [])

    useEffect(() => () => cancelFrame(), [cancelFrame])

    // A render mid-drag would repaint the variable from the (stale) atom and snap the rail
    // back; re-assert the dragged width after every render until release.
    useLayoutEffect(() => {
        const drag = dragRef.current
        if (!drag) return
        railRef.current?.style.setProperty("--ag-sidebar-w", `${drag.width}px`)
    })

    const handlePointerDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (disabled || event.button !== 0) return

            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: width,
                width,
            }
            railRef.current?.setAttribute("data-resizing", "true")
            document.body.style.userSelect = "none"
            document.body.style.cursor = "col-resize"
        },
        [disabled, railRef, width],
    )

    const handlePointerMove = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return

            drag.width = clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX))
            if (frameRef.current !== null) return

            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null
                const current = dragRef.current
                if (!current) return
                railRef.current?.style.setProperty("--ag-sidebar-w", `${current.width}px`)
            })
        },
        [railRef],
    )

    const handlePointerEnd = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return

            dragRef.current = null
            cancelFrame()
            railRef.current?.removeAttribute("data-resizing")
            document.body.style.removeProperty("user-select")
            document.body.style.removeProperty("cursor")
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
            }
            railRef.current?.style.setProperty("--ag-sidebar-w", `${drag.width}px`)
            setWidth(drag.width)
        },
        [cancelFrame, railRef, setWidth],
    )

    return {
        width,
        handleProps: {
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerEnd,
            onPointerCancel: handlePointerEnd,
        },
    }
}
