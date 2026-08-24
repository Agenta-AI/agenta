/**
 * useDriveTreeKeyboard — the tree pane's WAI-ARIA keyboard navigation, as one `onKeyDown` for the
 * scroll container. It drives focus through {@link useDriveTreeViewport}'s `focusTreeRow` and reads
 * the flat row index, so it needs no DOM of its own beyond `document.activeElement`.
 */
import {useCallback, type Dispatch, type KeyboardEvent, type SetStateAction} from "react"

import {type DriveTreeNode} from "./driveTree"
import {type FlatTreeRow} from "./driveTreeView"
import {type DriveTreeViewport} from "./useDriveTreeViewport"

export function useDriveTreeKeyboard({
    flatRows,
    indexByPath,
    nodeByPath,
    expanded,
    setExpanded,
    focusTreeRow,
}: {
    flatRows: FlatTreeRow[]
    indexByPath: Map<string, number>
    nodeByPath: Map<string, DriveTreeNode>
    expanded: Set<string>
    setExpanded: Dispatch<SetStateAction<Set<string>>>
    focusTreeRow: DriveTreeViewport["focusTreeRow"]
}) {
    // Tree keyboard nav (WAI-ARIA tree pattern) over the FLAT index: ↑/↓ move focus one visible row;
    // → expands a collapsed folder then steps into it; ← collapses an open folder else steps to the
    // parent; Home/End jump to the ends. Enter/Space stay the button's own onClick (select).
    const onTreeKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]
            if (!keys.includes(e.key)) return
            if (!flatRows.length) return
            e.preventDefault()
            const activePath = (document.activeElement as HTMLElement | null)?.getAttribute(
                "data-path",
            )
            const idx = activePath != null ? (indexByPath.get(activePath) ?? -1) : -1

            if (e.key === "Home") return focusTreeRow(0, 1)
            if (e.key === "End") return focusTreeRow(flatRows.length - 1, -1)
            if (e.key === "ArrowDown") return focusTreeRow(idx < 0 ? 0 : idx + 1, 1)
            if (e.key === "ArrowUp") return focusTreeRow(idx < 0 ? 0 : idx - 1, -1)

            if (activePath == null) return focusTreeRow(idx < 0 ? 0 : idx)
            const node = nodeByPath.get(activePath)
            const isFolder = node?.isFolder === true
            const isOpen = expanded.has(activePath)

            if (e.key === "ArrowRight") {
                if (isFolder && !isOpen) setExpanded((prev) => new Set(prev).add(activePath))
                else if (isFolder && isOpen) focusTreeRow(idx + 1)
                return
            }
            // ArrowLeft: collapse an open folder, else move focus to the parent row.
            if (isFolder && isOpen) {
                setExpanded((prev) => {
                    const next = new Set(prev)
                    next.delete(activePath)
                    return next
                })
                return
            }
            const parent = activePath.includes("/")
                ? activePath.split("/").slice(0, -1).join("/")
                : null
            if (parent != null) {
                const pIdx = indexByPath.get(parent)
                if (pIdx != null) focusTreeRow(pIdx)
            }
        },
        [flatRows.length, indexByPath, nodeByPath, expanded, focusTreeRow],
    )

    return onTreeKeyDown
}
