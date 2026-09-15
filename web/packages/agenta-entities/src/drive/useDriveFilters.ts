/**
 * useDriveFilters — the explorer's search term, listing filters (temporary / hidden / git-ignored
 * files) and view preferences (grid / list, sort, editor mode), plus the DEFERRED search term
 * everything downstream filters on. The chrome writes this state; the tree pipeline
 * ({@link useDriveTreeData}) reads it.
 *
 * Preferences persist per user (`atomWithStorage`). The two visibility toggles are SESSION state
 * seeded from their preference: the view-options menu writes both, while an upload reveal
 * (`useUploadReveal` flipping hidden files on to show a dotfile that just landed) writes only the
 * session copy — a reveal must never rewrite what the user chose.
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
// On by default: the session's working files (everything beside `agent-files/`) are what the
// agent is editing right now; the toggle is for narrowing to the persistent files.
export const driveShowTemporaryAtom = atomWithStorage<boolean>("agenta:drive:show-temporary", true)

export function useDriveFilters() {
    const [search, setSearch] = useState("")
    const [view, setView] = useAtom(driveViewModeAtom)
    const [sort, setSort] = useAtom(driveSortKeyAtom)
    const [editorMode, setEditorMode] = useAtom(driveEditorModeAtom)
    const [showTemporary, setShowTemporary] = useAtom(driveShowTemporaryAtom)
    const [showHiddenPref, setShowHiddenPref] = useAtom(driveShowHiddenPrefAtom)
    const [showGitignoredPref, setShowGitignoredPref] = useAtom(driveShowGitignoredPrefAtom)
    // Session copies, seeded once from the preference (see the module note).
    const [showHidden, setShowHidden] = useState(showHiddenPref)
    const [showGitignored, setShowGitignored] = useState(showGitignoredPref)
    // Both copies take the NEXT of the shown (session) value: after an upload reveal they can
    // differ, and flipping each independently would leave the menu showing the opposite of the
    // preference it just wrote.
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
