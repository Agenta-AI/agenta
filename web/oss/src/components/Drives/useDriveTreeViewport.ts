/**
 * useDriveTreeViewport — the tree pane's scroll element and everything that needs it: the row
 * virtualizer, the row-height measurer, focusing a row BY INDEX (scroll it in, then wait for it to
 * mount), and the once-per-open initial focus. The element ref stays here; the horizontal wheel
 * machinery gets it through the `attachTreeWheel` it passes in ({@link useTreeGroupScroll}).
 */
import {useCallback, useEffect, useRef} from "react"

import {useVirtualizer} from "@tanstack/react-virtual"

import {type FlatTreeRow} from "./driveTreeView"

export function useDriveTreeViewport({
    flatRows,
    indexByPath,
    selectedPath,
    rootLoading,
    attachTreeWheel,
}: {
    flatRows: FlatTreeRow[]
    indexByPath: Map<string, number>
    selectedPath: string | null
    /** The ROOT level hasn't landed yet — nothing to focus until it does. */
    rootLoading: boolean
    attachTreeWheel: (el: HTMLDivElement | null) => void
}) {
    // The tree scroll container is the virtualizer's scroll element — only the visible rows (+
    // overscan) mount, so expanding a folder with thousands of children never floods the DOM.
    const treeRef = useRef<HTMLDivElement>(null)
    const treeVirtualizer = useVirtualizer({
        count: flatRows.length,
        getScrollElement: () => treeRef.current,
        estimateSize: () => 28,
        overscan: 12,
        getItemKey: (i) => flatRows[i]?.node.path ?? i,
    })

    // Row-height measurement for the virtualizer.
    const measureRow = treeVirtualizer.measureElement

    /** Callback ref for the scroll div (it mounts after the skeleton): keep the element for the
     * virtualizer + row focus, and hand it to the horizontal-wheel owner. */
    const treeScrollRef = useCallback(
        (el: HTMLDivElement | null) => {
            treeRef.current = el
            attachTreeWheel(el)
        },
        [attachTreeWheel],
    )

    // Focus a row by its flat index, scrolling it into view first (it may not be rendered yet when
    // virtualized). Retries across a few frames until the row exists in the DOM.
    const focusTreeRow = useCallback(
        (index: number, dir: 1 | -1 = 1) => {
            if (!flatRows.length) return
            let target = Math.min(Math.max(index, 0), flatRows.length - 1)
            // Skip synthetic loading rows (no focusable control) in the travel direction.
            while (target >= 0 && target < flatRows.length && flatRows[target]?.loading)
                target += dir
            if (target < 0 || target >= flatRows.length) return
            treeVirtualizer.scrollToIndex(target, {align: "auto"})
            let tries = 0
            const tryFocus = () => {
                const el = treeRef.current?.querySelector<HTMLButtonElement>(
                    `[data-index="${target}"] button[data-tree-main]`,
                )
                if (el) el.focus()
                else if (tries++ < 3) requestAnimationFrame(tryFocus)
            }
            requestAnimationFrame(tryFocus)
        },
        [flatRows, treeVirtualizer],
    )

    // Initial focus: a <div>'s onKeyDown only fires when something inside is focused, so arrow keys
    // do nothing until a row is clicked. Once the listing is ready, focus the selected (else first)
    // row so keyboard nav works immediately on open. Runs once; won't steal focus from a field the
    // user is typing in (e.g. search) or if focus is already in the tree.
    const didInitialFocus = useRef(false)
    useEffect(() => {
        if (didInitialFocus.current || rootLoading || !flatRows.length) return
        const container = treeRef.current
        const active = document.activeElement as HTMLElement | null
        if (
            active &&
            (/^(input|textarea|select)$/i.test(active.tagName) ||
                Boolean(container?.contains(active)))
        ) {
            didInitialFocus.current = true
            return
        }
        const idx = selectedPath != null ? (indexByPath.get(selectedPath) ?? 0) : 0
        focusTreeRow(idx)
        didInitialFocus.current = true
    }, [rootLoading, selectedPath, flatRows.length, indexByPath, focusTreeRow])

    return {treeVirtualizer, measureRow, treeScrollRef, focusTreeRow}
}

export type DriveTreeViewport = ReturnType<typeof useDriveTreeViewport>
