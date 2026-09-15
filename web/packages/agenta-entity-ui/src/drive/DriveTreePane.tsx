/**
 * DriveTreePane — the two-pane LAYOUT: the width-animated tree pane (its rows passed in as `rows`),
 * the resize handle, and the content pane (`children`). The presentational half of
 * {@link useDriveTreePane}, which owns the MotionValues and the drag/visibility state it renders.
 */
import {type KeyboardEvent, type ReactNode} from "react"

import {type DriveDrop} from "@agenta/entities/drive"
import {type DriveTreePaneState} from "@agenta/entities/drive"
import {motion} from "motion/react"

export function DriveTreePane({
    pane,
    treeScrollRef,
    onTreeKeyDown,
    treeDropProps,
    rows,
    railHeader,
    contentHeader,
    children,
    mirrored = false,
}: {
    pane: DriveTreePaneState
    treeScrollRef: (el: HTMLDivElement | null) => void
    onTreeKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
    /** Drop-to-upload handlers for the tree's scroll container — absent = uploads disabled here. */
    treeDropProps?: ReturnType<DriveDrop["containerDropProps"]>
    /** The tree's virtualized rows (see DriveTreeList) — a slot, so this module stays pure geometry. */
    rows: ReactNode
    /** The rail's own header (the search field), pinned above the rows at the same height as the
     * content header so the two share one hairline. */
    railHeader?: ReactNode
    /** Row 2 — the context toolbar pinned above the content pane. */
    contentHeader?: ReactNode
    /** The content pane: the folder grid or the file preview. */
    children: ReactNode
    /** Dock the tree on the RIGHT and the content on the LEFT (row-reverse keeps DOM/focus order:
     * tree first). Pair with `useDriveTreePane({mirrored})` so the resize drag direction matches. */
    mirrored?: boolean
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
        <div className={`flex min-h-0 w-full flex-1 ${mirrored ? "flex-row-reverse" : ""}`}>
            {/* Width rides the `paneW` MotionValue: the toggle animates it (see the effect above),
                    a drag writes it per pointer move — either way motion updates the DOM directly,
                    no React render per frame. */}
            <motion.div
                className={`min-h-0 shrink-0 overflow-hidden border-0 border-solid border-colorBorderSecondary ${
                    mirrored ? "border-l" : "border-r"
                }`}
                style={{width: paneW}}
            >
                {/* Inner rides `innerW`, which a DRAG updates (content reflows to the new width)
                    but a COLLAPSE leaves at the rest width — the tree clips out cleanly instead of
                    reflowing as the pane narrows. `box-border` keeps `h-full`+padding inside the box
                    (preflight is off → content-box by default). */}
                <motion.div
                    className="box-border flex h-full min-h-0 flex-col overflow-hidden bg-colorBgLayout"
                    style={{width: innerW}}
                >
                    {railHeader ? (
                        <div className="flex h-9 shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary px-2">
                            {railHeader}
                        </div>
                    ) : null}
                    <div
                        ref={treeScrollRef}
                        // Vertical scroll is native; horizontal is intercepted (treeScrollRef)
                        // and routed to the hovered row's FOLDER GROUP (transform), so siblings
                        // scroll together. `overscroll-contain` stops rubber-band chaining.
                        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2"
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
            {/* The content column is the pane's reading surface (the design's white board; the rail
                sits on the layout tone beside it) — also what the list view's sticky header,
                which is `bg-background`, has to sit on so it doesn't read as a lighter strip. */}
            <div className="flex min-w-0 flex-1 flex-col bg-background">
                {contentHeader}
                {children}
            </div>
        </div>
    )
}
