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

    // …then scroll the revealed row into view. Read the LIVE index via a ref (not deps) so this fires
    // only on a selection change, not on every unrelated expand; retry across a few frames because the
    // row appears only after the expand above re-flattens the tree.
    const indexByPathRef = useRef(indexByPath)
    indexByPathRef.current = indexByPath
    useEffect(() => {
        if (!selectedPath) return
        let raf = 0
        let tries = 0
        const scroll = () => {
            const idx = indexByPathRef.current.get(selectedPath)
            if (idx != null) treeVirtualizer.scrollToIndex(idx, {align: "auto"})
            else if (tries++ < 5) raf = requestAnimationFrame(scroll)
        }
        raf = requestAnimationFrame(scroll)
        return () => cancelAnimationFrame(raf)
    }, [selectedPath, treeVirtualizer])
}
