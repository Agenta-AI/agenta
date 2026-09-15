/**
 * The explorer's search term, listing filters and persisted view preferences. The hidden /
 * git-ignored toggles are session state seeded from their preference: the menu writes both, an
 * upload reveal writes the session copy only.
 */
import {useCallback, useDeferredValue, useState} from "react"

import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

export type DriveViewMode = "grid" | "list"
export type DriveSortKey = "name" | "modified" | "size"
export type DriveEditorMode = "rendered" | "source"

export const driveViewModeAtom = atomWithStorage<DriveViewMode>("agenta:drive:view", "grid")
export const driveSortKeyAtom = atomWithStorage<DriveSortKey>("agenta:drive:sort", "name")
export const driveEditorModeAtom = atomWithStorage<DriveEditorMode>(
    "agenta:drive:editor-mode",
    "rendered",
)
export const driveShowHiddenPrefAtom = atomWithStorage<boolean>("agenta:drive:show-hidden", false)
export const driveShowGitignoredPrefAtom = atomWithStorage<boolean>(
    "agenta:drive:show-gitignored",
    false,
)
// On by default; the toggle narrows to the persistent files.
export const driveShowTemporaryAtom = atomWithStorage<boolean>("agenta:drive:show-temporary", true)

export function useDriveFilters() {
    const [search, setSearch] = useState("")
    const [view, setView] = useAtom(driveViewModeAtom)
    const [sort, setSort] = useAtom(driveSortKeyAtom)
    const [editorMode, setEditorMode] = useAtom(driveEditorModeAtom)
    const [showTemporary, setShowTemporary] = useAtom(driveShowTemporaryAtom)
    const [showHiddenPref, setShowHiddenPref] = useAtom(driveShowHiddenPrefAtom)
    const [showGitignoredPref, setShowGitignoredPref] = useAtom(driveShowGitignoredPrefAtom)
    // Session copies, seeded once from the preference.
    const [showHidden, setShowHidden] = useState(showHiddenPref)
    const [showGitignored, setShowGitignored] = useState(showGitignoredPref)
    // Both copies take the next of the SHOWN value (a reveal can leave them differing).
    const toggleShowHiddenPref = useCallback(() => {
        const next = !showHidden
        setShowHiddenPref(next)
        setShowHidden(next)
    }, [showHidden, setShowHiddenPref])
    const toggleShowGitignoredPref = useCallback(() => {
        const next = !showGitignored
        setShowGitignoredPref(next)
        setShowGitignored(next)
    }, [showGitignored, setShowGitignoredPref])

    // Defer the search term so typing stays responsive — the input updates now, the filter/flatten
    // trails a frame (React interrupts it if you keep typing).
    const deferredSearch = useDeferredValue(search)
    const searchActive = deferredSearch.trim() !== ""

    return {
        search,
        setSearch,
        deferredSearch,
        searchActive,
        showTemporary,
        setShowTemporary,
        showHidden,
        setShowHidden,
        toggleShowHiddenPref,
        showGitignored,
        setShowGitignored,
        toggleShowGitignoredPref,
        view,
        setView,
        sort,
        setSort,
        editorMode,
        setEditorMode,
    }
}
