import {
    type PointerEvent as ReactPointerEvent,
    type RefObject,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
} from "react"

import {useAtom} from "jotai"

import {createRailMotion} from "./railMotion"
import {sidebarWidthAtom} from "./state"

interface UseSidebarResizeParams {
    /** The rail element that owns `--ag-sidebar-w`; the drag repaints it directly. */
    railRef: RefObject<HTMLDivElement | null>
    /** The rail's content column, faded while a drag collapses or opens the rail. */
    contentRef: RefObject<HTMLDivElement | null>
    collapsed: boolean
    setCollapsed: (collapsed: boolean) => void
}

const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

/**
 * Drag-to-resize for the expanded rail, drag-to-collapse past its minimum, and drag-to-open from
 * the icon rail. A drag costs zero React renders until the rail collapses, opens, or settles.
 */
export const useSidebarResize = ({
    railRef,
    contentRef,
    collapsed,
    setCollapsed,
}: UseSidebarResizeParams) => {
    const [width, setWidth] = useAtom(sidebarWidthAtom)
    const live = useRef({width, collapsed, setCollapsed})

    const controller = useMemo(
        () =>
            createRailMotion({
                rail: () => railRef.current,
                content: () => contentRef.current,
                readWidth: () => live.current.width,
                isCollapsed: () => live.current.collapsed,
                setCollapsed: (next) => live.current.setCollapsed(next),
                setWidth,
                prefersReducedMotion,
            }),
        [contentRef, railRef, setWidth],
    )

    useEffect(() => controller.dispose, [controller])
    useLayoutEffect(() => {
        live.current = {width, collapsed, setCollapsed}
        controller.sync(collapsed, width)
    })

    const handleProps = useMemo(
        () => ({
            onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) =>
                controller.pointerDown(event),
            onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) =>
                controller.pointerMove(event),
            onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => controller.pointerEnd(event),
            onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) =>
                controller.pointerEnd(event),
            onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) =>
                controller.pointerEnd(event),
        }),
        [controller],
    )

    return {width, handleProps}
}
