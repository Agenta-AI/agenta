import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type RefObject,
} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {cn} from "@agenta/ui/styles"

/**
 * push = beside the page; overlay = over the page's right side (under 1100 px or widened);
 * full = it covers the whole screen (a phone, an expanded Files).
 */
export type PanelMode = "push" | "overlay" | "full"

export interface PanelResize {
    min: number
    max: number
    /** A width while the drag runs. */
    onLive: (width: number) => void
    /** The width to keep: at pointer-up and on each arrow key step. */
    onCommit: (width: number) => void
}

/**
 * The right panel: full height at the right edge of its host, beside the page header (the header
 * ends at the panel edge), with the resize edge. In overlay mode it starts under `overlayTop`, so
 * the header icons it would cover stay in reach. Escape closes it unless a view, menu or dialog
 * inside takes the key first.
 */
export const AgentPanelFrame = ({
    open,
    mode,
    width,
    resize,
    overlayTop,
    panelRef,
    onClose,
    children,
}: {
    open: boolean
    mode: PanelMode
    width: number
    /** Null: no resize edge (a widened view). */
    resize: PanelResize | null
    /** A class that sets the top of the overlay (the header height). */
    overlayTop?: string
    /** The panel element; the host focuses it when the panel opens, so Escape reaches it. */
    panelRef: RefObject<HTMLDivElement | null>
    onClose: () => void
    children: ReactNode
}) => {
    const tControls = useT(uiControlsCatalog)
    const clamp = (value: number) =>
        resize ? Math.min(resize.max, Math.max(resize.min, value)) : value
    // Beside the page the panel may draw narrower than `width` (the page keeps its column). A
    // drag and the arrow keys start from the drawn width, so the edge moves with the pointer; the
    // width the person lets go at is the one stored.
    const frameRef = useRef<HTMLDivElement>(null)
    const [drawn, setDrawn] = useState<number | null>(null)
    useEffect(() => {
        const frame = frameRef.current
        if (!frame || mode !== "push" || typeof ResizeObserver === "undefined") {
            setDrawn(null)
            return undefined
        }
        const observer = new ResizeObserver(() => setDrawn(Math.round(frame.offsetWidth)))
        observer.observe(frame)
        return () => observer.disconnect()
    }, [mode])
    const shownWidth = drawn !== null && drawn > 0 ? Math.min(width, drawn) : width
    // What a resize stores: the width the panel draws once the page has taken its column, so a
    // drag past the room there is does not store a width the panel never showed.
    const commitDrawn = (value: number) => {
        if (!resize) return
        requestAnimationFrame(() => {
            const frame = frameRef.current
            const room = mode === "push" && frame ? Math.round(frame.offsetWidth) : value
            resize.onCommit(clamp(Math.min(value, room)))
        })
    }
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!resize) return
        const pointerId = event.pointerId
        const startX = event.clientX
        const startWidth = shownWidth
        const widthAt = (x: number) => clamp(startWidth + startX - x)
        const move = (e: PointerEvent) => {
            if (e.pointerId === pointerId) resize.onLive(widthAt(e.clientX))
        }
        const stop = () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", up)
            window.removeEventListener("pointercancel", cancel)
        }
        const up = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return
            stop()
            // Stored at pointer-up, not on every move.
            commitDrawn(widthAt(e.clientX))
        }
        // A cancelled drag (a touch the browser took over) goes back to the stored width.
        const cancel = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return
            stop()
            resize.onLive(startWidth)
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", up)
        window.addEventListener("pointercancel", cancel)
        event.preventDefault()
    }
    // The ARIA window-splitter keys: arrows move 16 px, and each step is stored.
    const keyResize = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!resize) return
        const step = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0
        if (!step) return
        event.preventDefault()
        const next = clamp(shownWidth + step)
        resize.onLive(next)
        commitDrawn(next)
    }

    return (
        <div
            ref={frameRef}
            className={cn(
                "min-h-0",
                !open && "hidden",
                // Beside the page it gives way to the page's minimum column, down to its own
                // minimum width; over the page it keeps its width.
                mode === "push" ? "relative h-full shrink" : "shrink-0",
                mode === "overlay" &&
                    cn("absolute bottom-0 right-0 z-20 shadow-overlay", overlayTop ?? "top-0"),
                mode === "full" && "absolute inset-0 z-30",
                mode !== "full" && "border-0 border-l border-solid border-colorBorderSecondary",
            )}
            style={
                mode === "full"
                    ? undefined
                    : {
                          width,
                          minWidth:
                              mode === "push" ? Math.min(width, resize?.min ?? width) : undefined,
                      }
            }
            onKeyDown={(event) => {
                // A view goes back first (the view stack handles it); a menu or dialog closes itself.
                // What is left closes the panel, also from the resize edge.
                if (event.key !== "Escape" || event.defaultPrevented) return
                const layer = (event.target as HTMLElement).closest?.(
                    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
                )
                if (layer && layer !== event.currentTarget) return
                event.preventDefault()
                onClose()
            }}
        >
            {mode !== "full" && resize ? (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={resize.min}
                    aria-valuemax={resize.max}
                    aria-valuenow={shownWidth}
                    aria-label={tControls("ui.controls.resizePanes")}
                    tabIndex={0}
                    className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none"
                    onPointerDown={startDrag}
                    onKeyDown={keyResize}
                />
            ) : null}
            <div
                ref={panelRef}
                tabIndex={-1}
                data-testid="agent-panel"
                className="ag-panel-raised flex h-full min-h-0 w-full flex-col outline-none"
            >
                {children}
            </div>
        </div>
    )
}
