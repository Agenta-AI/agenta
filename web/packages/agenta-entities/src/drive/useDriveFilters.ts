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

// Read from storage on init: the session copies below seed from these on first render, and the
// pane is client-only.
const pref = <T>(key: string, initial: T) =>
    atomWithStorage<T>(`agenta:drive:${key}`, initial, undefined, {getOnInit: true})

const driveViewModeAtom = pref<DriveViewMode>("view", "grid")
// Newest first by default, so a file you just made is the first tile, not wherever its name lands.
const driveSortKeyAtom = pref<DriveSortKey>("sort", "modified")
const driveEditorModeAtom = pref<DriveEditorMode>("editor-mode", "rendered")
const driveShowHiddenPrefAtom = pref("show-hidden", false)
const driveShowGitignoredPrefAtom = pref("show-gitignored", false)
// On by default; the toggle narrows to the persistent files.
const driveShowTemporaryAtom = pref("show-temporary", true)

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
