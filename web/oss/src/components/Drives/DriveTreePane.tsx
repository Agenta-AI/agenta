/**
 * DriveTreePane — the two-pane LAYOUT: the width-animated tree pane (its rows passed in as `rows`),
 * the resize handle, and the content pane (`children`). The presentational half of
 * {@link useDriveTreePane}, which owns the MotionValues and the drag/visibility state it renders.
 */
import {type KeyboardEvent, type ReactNode} from "react"

import {motion} from "motion/react"

import {type DriveDrop} from "./useDriveDrop"
import {type DriveTreePaneState} from "./useDriveTreePane"

export function DriveTreePane({
    pane,
    treeScrollRef,
    onTreeKeyDown,
    treeDropProps,
    rows,
    children,
}: {
    pane: DriveTreePaneState
    treeScrollRef: (el: HTMLDivElement | null) => void
    onTreeKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
    /** Drop-to-upload handlers for the tree's scroll container — absent = uploads disabled here. */
    treeDropProps?: ReturnType<DriveDrop["containerDropProps"]>
    /** The tree's virtualized rows (see DriveTreeList) — a slot, so this module stays pure geometry. */
    rows: ReactNode
    /** The content pane: the folder grid or the file preview. */
    children: ReactNode
}) {
    const {
        paneW,
        innerW,
        treeVisible,
        treeDragging,
        onTreeHandleDown,
        onTreeHandleMove,
        onTreeHandleUp,
    } = pane
    // The one presentation: the file TREE pane (unless hidden) + the content pane. The tree pane is a
    // motion.div whose WIDTH animates 0↔TREE_WIDTH; the content pane (flex-fill) tracks it in one
    // continuous pass. The tree's INNER content is a FIXED TREE_WIDTH box clipped by the outer
    // `overflow-hidden`, so it slides out cleanly (its rows never reflow as the pane narrows).
    return (
        <div className="flex min-h-0 w-full flex-1">
            {/* Width rides the `paneW` MotionValue: the toggle animates it (see the effect above),
                    a drag writes it per pointer move — either way motion updates the DOM directly,
                    no React render per frame. */}
            <motion.div
                className="min-h-0 shrink-0 overflow-hidden border-0 border-r border-solid border-colorBorderSecondary"
                style={{width: paneW}}
            >
                {/* Inner rides `innerW`, which a DRAG updates (content reflows to the new width)
                    but a COLLAPSE leaves at the rest width — the tree clips out cleanly instead of
                    reflowing as the pane narrows. `box-border` keeps `h-full`+padding inside the box
                    (preflight is off → content-box by default). */}
                <motion.div
                    className="box-border flex h-full min-h-0 flex-col overflow-hidden px-3 pb-3 pt-2"
                    style={{width: innerW}}
                >
                    <div
                        ref={treeScrollRef}
                        // Vertical scroll is native; horizontal is intercepted (treeScrollRef)
                        // and routed to the hovered row's FOLDER GROUP (transform), so siblings
                        // scroll together. `overscroll-contain` stops rubber-band chaining.
                        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
                        onKeyDown={onTreeKeyDown}
                        {...(treeDropProps ?? {})}
                    >
                        {rows}
                    </div>
                </motion.div>
            </motion.div>
            {/* Resize handle — a WIDE invisible hit target straddling the tree's right edge, with a
                    thin 1px line that only lights up on hover/drag (the tree's own border is the resting
                    divider). Only while the tree is shown (nothing to resize when collapsed). */}
            {treeVisible ? (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize file tree"
                    onPointerDown={onTreeHandleDown}
                    onPointerMove={onTreeHandleMove}
                    onPointerUp={onTreeHandleUp}
                    className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none"
                >
                    <div
                        className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${treeDragging ? "bg-colorPrimary" : "bg-transparent group-hover:bg-colorPrimary"}`}
                    />
                </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
    )
}
