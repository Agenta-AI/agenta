/**
 * useDriveTreePane — the tree pane's GEOMETRY: shown/hidden, the draggable rest width, the two
 * MotionValues the panes actually animate on, and the anticipated-shift announcement the tile grid
 * needs the moment visibility flips. Search forces the pane open, so it takes `searchActive`.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {animate, useMotionValue} from "motion/react"

import {TREE_MAX, TREE_MIN, TREE_TRANSITION, TREE_WIDTH} from "./driveTreeView"

export function useDriveTreePane({searchActive}: {searchActive: boolean}) {
    // The one presentation is the tree navigator + content pane; the file TREE pane can be hidden to
    // give the content pane the full width. Searching always forces the tree (its filtered rows ARE
    // the results), so the effective visibility is `showTree || searchActive` (see `treeVisible`).
    const [showTree, setShowTree] = useState(true)
    const toggleTree = useCallback(() => setShowTree((v) => !v), [])
    // Draggable tree-pane width. The REST width is React state (persists across a hide/show and feeds
    // the toggle's anticipated-shift math), committed ONCE at drag end. The LIVE width is a
    // MotionValue pair driven straight from the pointer — motion writes the DOM directly, so a drag
    // re-renders NOTHING per move (state-per-move re-rendered this whole component per pointer event,
    // which is exactly the jank a splitter drag can't afford). `paneW` is the clipping pane (0 when
    // hidden); `innerW` is the tree content, which follows a DRAG (content reflows to the new width)
    // but holds its rest width through a COLLAPSE (content clips, never reflows).
    const [treeWidth, setTreeWidth] = useState(TREE_WIDTH)
    const [treeDragging, setTreeDragging] = useState(false)
    const paneW = useMotionValue(TREE_WIDTH)
    const innerW = useMotionValue(TREE_WIDTH)
    const treeDrag = useRef<{startX: number; startW: number} | null>(null)
    const onTreeHandleDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            treeDrag.current = {startX: e.clientX, startW: paneW.get()}
            setTreeDragging(true)
        },
        [paneW],
    )
    const onTreeHandleMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const st = treeDrag.current
            if (!st) return
            const w = Math.min(TREE_MAX, Math.max(TREE_MIN, st.startW + (e.clientX - st.startX)))
            paneW.set(w)
            innerW.set(w)
        },
        [paneW, innerW],
    )
    const onTreeHandleUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (!treeDrag.current) return
            treeDrag.current = null
            setTreeDragging(false)
            setTreeWidth(Math.round(paneW.get()))
            e.currentTarget.releasePointerCapture?.(e.pointerId)
        },
        [paneW],
    )

    // The tree pane shows whenever the user hasn't hidden it OR a search is active (the filtered tree
    // rows ARE the search results, so search always needs it).
    const treeVisible = showTree || searchActive
    // ANTICIPATED pane shift — the moment the tree pane's visibility flips, the content pane's FINAL
    // width is already known (current ± treeWidth). Announce it to the tile grid so it lays out ONCE
    // for the final rest layout and springs there in one monotonic motion; deriving columns from the
    // live mid-tween width instead would grow tiles toward the column threshold and then shrink them
    // past it (the "larger then smaller" artifact). Detected DURING render so the announcement lands
    // in the same commit as the width flip. Rapid re-toggles chain: the grid adds deltas onto its
    // in-flight target, so hide-then-show mid-tween resolves back to the original layout.
    const [prevTreeVisible, setPrevTreeVisible] = useState(treeVisible)
    const [treeShift, setTreeShift] = useState<{delta: number; seq: number} | null>(null)
    if (treeVisible !== prevTreeVisible) {
        setPrevTreeVisible(treeVisible)
        setTreeShift((s) => ({
            delta: treeVisible ? -treeWidth : treeWidth,
            seq: (s?.seq ?? 0) + 1,
        }))
    }
    // Animate the pane's MotionValue on a visibility flip (a drag writes the value directly instead —
    // see the drag block). Re-running on a drag-end `treeWidth` commit is a no-op (already there).
    useEffect(() => {
        const controls = animate(paneW, treeVisible ? treeWidth : 0, TREE_TRANSITION)
        return () => controls.stop()
    }, [treeVisible, treeWidth, paneW])

    return {
        showTree,
        toggleTree,
        treeVisible,
        treeDragging,
        paneW,
        innerW,
        onTreeHandleDown,
        onTreeHandleMove,
        onTreeHandleUp,
        treeShift,
    }
}

export type DriveTreePaneState = ReturnType<typeof useDriveTreePane>
