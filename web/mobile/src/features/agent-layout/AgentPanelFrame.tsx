import type {
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    ReactNode,
    RefObject,
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
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!resize) return
        const pointerId = event.pointerId
        const startX = event.clientX
        const startWidth = width
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
            resize.onCommit(widthAt(e.clientX))
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
        const next = clamp(width + step)
        resize.onLive(next)
        resize.onCommit(next)
    }

    return (
        <div
            className={cn(
                "min-h-0 shrink-0",
                !open && "hidden",
                mode === "push" && "relative h-full",
                mode === "overlay" &&
                    cn("absolute bottom-0 right-0 z-20 shadow-overlay", overlayTop ?? "top-0"),
                mode === "full" && "absolute inset-0 z-30",
                mode !== "full" && "border-0 border-l border-solid border-colorBorderSecondary",
            )}
            style={mode === "full" ? undefined : {width}}
        >
            {mode !== "full" && resize ? (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={resize.min}
                    aria-valuemax={resize.max}
                    aria-valuenow={width}
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
                onKeyDown={(event) => {
                    // A view goes back first (the view stack handles it); a menu or dialog closes
                    // itself. What is left closes the panel.
                    if (event.key !== "Escape" || event.defaultPrevented) return
                    const layer = (event.target as HTMLElement).closest?.(
                        '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
                    )
                    if (layer && layer !== event.currentTarget) return
                    event.preventDefault()
                    onClose()
                }}
            >
                {children}
            </div>
        </div>
    )
}
