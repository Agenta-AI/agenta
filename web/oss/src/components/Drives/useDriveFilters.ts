/**
 * useDriveFilters — the explorer's search term and listing filters (origin, hidden files,
 * git-ignored), plus the DEFERRED search term everything downstream filters on. The toolbar writes
 * this state; the tree pipeline ({@link useDriveTreeData}) reads it.
 */
import {useDeferredValue, useState} from "react"

import {type FileOrigin} from "./useSessionDrive"

export function useDriveFilters() {
    // Search + filters live in the drawer's shared toolbar (the header row 2). Self-managed here.
    const [search, setSearch] = useState("")
    const [originFilter, setOriginFilter] = useState<"all" | FileOrigin>("all")
    const [showHidden, setShowHidden] = useState(true)
    // Show `.gitignore`-matched files (node_modules, build output, …). Off by default — the toggle
    // only appears when we're inside a git repo (see `inGitScope`).
    const [showGitignored, setShowGitignored] = useState(false)

    // Defer the search term so typing stays responsive — the input updates now, the filter/flatten
    // trails a frame (React interrupts it if you keep typing).
    const deferredSearch = useDeferredValue(search)
    const searchActive = deferredSearch.trim() !== ""

    return {
        search,
        setSearch,
        originFilter,
        setOriginFilter,
        showHidden,
        setShowHidden,
        showGitignored,
        setShowGitignored,
        deferredSearch,
        searchActive,
    }
}
