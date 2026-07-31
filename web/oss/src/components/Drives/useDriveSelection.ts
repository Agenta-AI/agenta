/**
 * useDriveSelection — WHAT the explorer is looking at: the selected path (persisted per drive so a
 * drawer close/reopen restores it) and the tree's expanded-folder set, whose mount-time value is
 * seeded from the same initial selection. Also owns the effects that keep the selection honest:
 * adopting the persisted selection once the drive's mount id resolves, adopting a CHANGED
 * `initialPath` while already open, and landing on the root folder when nothing was pre-selected.
 *
 * Handles `mountId` arriving late, NOT one drive being swapped for another — that invalidates every
 * mount-scoped hook at once and is handled by remounting (see `useDriveGeneration` in FilesDrawer).
 */
import {useCallback, useEffect, useRef, useState} from "react"

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
    // `mountId` arrives with mount DISCOVERY, so the first renders can carry "" — which is not a
    // drive. Seeding from or writing to that slot would both cross-contaminate every mountless drive
    // and lose the real one's last selection, so "" is read as empty and never written; the effect
    // below adopts the real slot once the id lands.
    const hasMount = Boolean(mountId)
    const [persistedRaw, setPersistedSelection] = useAtom(driveSelectionAtomFamily(mountId))
    const persistedSelection = hasMount ? persistedRaw : null

    // Restore the last-viewed file on (re)mount: explicit initialPath wins, else the persisted
    // per-drive selection, else null (the effect below picks the most-recent).
    const [selectedPath, setSelectedPath] = useState<string | null>(
        () => initialPath ?? persistedSelection ?? null,
    )
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const init = initialPath ?? persistedSelection ?? null
        return new Set(init ? ancestorPaths(init) : [])
    })
    const expand = useCallback((path: string) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            const before = next.size
            for (const a of ancestorPaths(path)) next.add(a)
            return next.size === before ? prev : next
        })
    }, [])

    // Landing on the root is a DEFAULT, not a choice — only a real pick is worth restoring later.
    const chosenRef = useRef(false)
    // Select a file: update local state AND persist it per drive so reopening restores it.
    const select = useCallback(
        (nextPath: string | null) => {
            chosenRef.current = true
            setSelectedPath(nextPath)
            if (hasMount) setPersistedSelection(nextPath)
        },
        [hasMount, setPersistedSelection],
    )

    // Once the drive's id resolves: adopt its persisted selection (the lazy initializers above ran
    // before mount discovery finished, so they couldn't see it) — or, if a pick was already made
    // against no mount, flush that pick into the now-real slot. Runs once.
    const adoptedRef = useRef(hasMount)
    useEffect(() => {
        if (!hasMount || adoptedRef.current) return
        adoptedRef.current = true
        if (chosenRef.current) {
            setPersistedSelection(selectedPath)
            return
        }
        if (!persistedSelection) return
        setSelectedPath(persistedSelection)
        expand(persistedSelection)
    }, [hasMount, selectedPath, persistedSelection, setPersistedSelection, expand])

    // React to a CHANGED initialPath while already open — the chat host opens the drawer once and
    // then routes a chat link / tile by pushing a new initialPath (its quick-look), so the drawer
    // must re-select it in place. Fires only when the prop value changes, not on every render, so it
    // never fights the user's own tree navigation.
    useEffect(() => {
        if (initialPath != null) select(initialPath)
    }, [initialPath])

    // Nothing was pre-selected — the drawer was opened via the Files COUNT ("browse"), not a file
    // row. Land on the ROOT folder view, not a file preview. `selectedPath != null` (not truthy) so the
    // empty-string root selection doesn't re-trigger. Not routed through `select`: an automatic
    // landing must not overwrite the persisted selection it may still be waiting to adopt.
    useEffect(() => {
        if (selectedPath != null) return
        setSelectedPath("")
    }, [selectedPath])

    return {persistedSelection, selectedPath, select, expanded, setExpanded}
}
