/**
 * useDriveSelection — WHAT the explorer is looking at: the selected path (persisted per drive so a
 * drawer close/reopen restores it) and the tree's expanded-folder set, whose mount-time value is
 * seeded from the same initial selection. Also owns the two effects that keep the selection honest:
 * adopting a CHANGED `initialPath` while already open, and landing on the root folder when nothing
 * was pre-selected.
 */
import {useCallback, useEffect, useState} from "react"

import {atom, useAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {ancestorPaths} from "./driveTree"

/** Last-viewed file per drive (keyed by mount id), so closing + reopening the drawer restores the
 * selection instead of resetting to the most-recent file. Module-level → survives the drawer's
 * destroyOnClose remount. */
const driveSelectionAtomFamily = atomFamily((_mountId: string) => atom<string | null>(null))

export function useDriveSelection({
    mountId,
    initialPath,
}: {
    mountId: string
    initialPath?: string | null
}) {
    // Restore the last-viewed file on (re)mount: explicit initialPath wins, else the persisted
    // per-drive selection, else null (the effect below picks the most-recent).
    const [persistedSelection, setPersistedSelection] = useAtom(driveSelectionAtomFamily(mountId))
    const [selectedPath, setSelectedPath] = useState<string | null>(
        () => initialPath ?? persistedSelection ?? null,
    )
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const init = initialPath ?? persistedSelection ?? null
        return new Set(init ? ancestorPaths(init) : [])
    })

    // Select a file: update local state AND persist it per drive so reopening restores it.
    const select = useCallback(
        (nextPath: string | null) => {
            setSelectedPath(nextPath)
            setPersistedSelection(nextPath)
        },
        [setPersistedSelection],
    )

    // React to a CHANGED initialPath while already open — the chat host opens the drawer once and
    // then routes a chat link / tile by pushing a new initialPath (its quick-look), so the drawer
    // must re-select it in place. Fires only when the prop value changes, not on every render, so it
    // never fights the user's own tree navigation.
    useEffect(() => {
        if (initialPath != null) select(initialPath)
    }, [initialPath])

    // Nothing was pre-selected — the drawer was opened via the Files COUNT ("browse"), not a file
    // row. Land on the ROOT folder view, not a file preview. `selectedPath != null` (not truthy) so the
    // empty-string root selection doesn't re-trigger.
    useEffect(() => {
        if (selectedPath != null) return
        select("")
    }, [selectedPath, select])

    return {persistedSelection, selectedPath, select, expanded, setExpanded}
}
