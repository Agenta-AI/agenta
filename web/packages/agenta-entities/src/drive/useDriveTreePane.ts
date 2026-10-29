/**
 * useDriveTreePane — the tree pane's GEOMETRY: shown/hidden, the draggable rest width, the two
 * MotionValues the panes actually animate on, and the anticipated-shift announcement the tile grid
 * needs the moment visibility flips.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {atom, useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {animate, useMotionValue} from "motion/react"

import {TREE_MAX, TREE_MIN, TREE_TRANSITION, TREE_WIDTH} from "./driveTreeView"

interface TreeRest {
    show: boolean
    width: number
}

// A host that names itself keeps the tree's rest state across closes and reloads.
const treeRestPrefFamily = atomFamily((key: string) =>
    atomWithStorage<TreeRest | null>(`agenta:drive:tree:${key}`, null, undefined, {
        getOnInit: true,
    }),
)

export function useDriveTreePane({
    mirrored = false,
    initialWidth = TREE_WIDTH,
    initialShow = true,
    persistKey,
}: {
    /** Tree pane docked on the RIGHT (content left) — inverts the resize-drag direction. */
    mirrored?: boolean
    /** Starting rest width — hosts with less room (the docked pane) open the tree narrower. */
    initialWidth?: number
    /** Open with the tree collapsed (a single-file quick look); the toolbar toggle reveals it. */
    initialShow?: boolean
    /** Remember shown/hidden and the rest width under this key; the initial* props are the defaults. */
    persistKey?: string
}) {
    const restAtom = useMemo(
        () => (persistKey ? treeRestPrefFamily(persistKey) : atom<TreeRest | null>(null)),
        [persistKey],
    )
    const [rest, setRest] = useAtom(restAtom)
    // The file TREE pane can be hidden to give the content pane the full width.
    const showTree = rest?.show ?? initialShow
    const treeWidth = rest?.width ?? initialWidth
    const toggleTree = useCallback(
        () => setRest((r) => ({show: !(r?.show ?? initialShow), width: r?.width ?? initialWidth})),
        [setRest, initialShow, initialWidth],
    )
    // Draggable tree-pane width. The REST width is React state (persists across a hide/show and feeds
    // the toggle's anticipated-shift math), committed ONCE at drag end. The LIVE width is a
    // MotionValue pair driven straight from the pointer — motion writes the DOM directly, so a drag
    // re-renders NOTHING per move (state-per-move re-rendered this whole component per pointer event,
    // which is exactly the jank a splitter drag can't afford). `paneW` is the clipping pane (0 when
    // hidden); `innerW` is the tree content, which follows a DRAG (content reflows to the new width)
    // but holds its rest width through a COLLAPSE (content clips, never reflows).
    const [treeDragging, setTreeDragging] = useState(false)
    // Start the clip pane at 0 when the tree opens hidden, so mount doesn't flash-animate it shut.
    const paneW = useMotionValue(showTree ? treeWidth : 0)
    const innerW = useMotionValue(treeWidth)
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
            // Mirrored: the tree sits right of the handle, so dragging LEFT widens it.
            const delta = mirrored ? st.startX - e.clientX : e.clientX - st.startX
            const w = Math.min(TREE_MAX, Math.max(TREE_MIN, st.startW + delta))
            paneW.set(w)
            innerW.set(w)
        },
        [paneW, innerW, mirrored],
    )
    const onTreeHandleUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (!treeDrag.current) return
            treeDrag.current = null
            setTreeDragging(false)
            const width = Math.round(paneW.get())
            setRest((r) => ({show: r?.show ?? initialShow, width}))
            e.currentTarget.releasePointerCapture?.(e.pointerId)
        },
        [paneW, setRest, initialShow],
    )

    const treeVisible = showTree
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
