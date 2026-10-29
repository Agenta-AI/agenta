/**
 * useDriveTreeReveal — keeps the TREE in sync with a selection made elsewhere (grid tile, breadcrumb,
 * chat link): expand the selection's ancestors, then scroll the revealed row into view. The pair is
 * one concern in two effects because the row only exists after the expand re-flattens the tree.
 */
import {useEffect, useRef, type Dispatch, type SetStateAction} from "react"

import {ancestorPaths} from "./driveTree"
import {type DriveTreeViewport} from "./useDriveTreeViewport"

export function useDriveTreeReveal({
    selectedPath,
    selectedIsFolder,
    setExpanded,
    indexByPath,
    treeVirtualizer,
}: {
    selectedPath: string | null
    selectedIsFolder: boolean
    setExpanded: Dispatch<SetStateAction<Set<string>>>
    indexByPath: Map<string, number>
    treeVirtualizer: DriveTreeViewport["treeVirtualizer"]
}) {
    // Navigating via the GRID tiles / breadcrumb (not the tree) updates `selectedPath` but not the
    // tree's expanded set — so the tree stayed collapsed and didn't follow. Mirror the selection into
    // the tree: expand its ancestors (and the folder itself, matching a tree-row click) so the row is
    // revealed. Idempotent + only adds, so a manual collapse elsewhere isn't fought.
    useEffect(() => {
        if (!selectedPath) return
        setExpanded((prev) => {
            const next = new Set(prev)
            let changed = false
            for (const a of ancestorPaths(selectedPath)) {
                if (!next.has(a)) {
                    next.add(a)
                    changed = true
                }
            }
            if (selectedIsFolder && !next.has(selectedPath)) {
                next.add(selectedPath)
                changed = true
            }
            return changed ? next : prev
        })
    }, [selectedPath, selectedIsFolder])

    // …then scroll the revealed row into view, once per selection, whenever its row first exists —
    // that can be several fetches later when the ancestors load lazily or a filter has to flip.
    const scrolledFor = useRef<string | null>(null)
    const index = selectedPath ? indexByPath.get(selectedPath) : undefined
    useEffect(() => {
        if (!selectedPath || index == null || scrolledFor.current === selectedPath) return
        scrolledFor.current = selectedPath
        treeVirtualizer.scrollToIndex(index, {align: "auto"})
    }, [selectedPath, index, treeVirtualizer])
}
