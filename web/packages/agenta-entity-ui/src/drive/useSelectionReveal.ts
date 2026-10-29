/**
 * useSelectionReveal — a file opened from outside the tree (a chat link, the grid, the breadcrumb)
 * must show up in the tree, even when the drive's filters hide where it lives: a dotfile folder
 * with hidden files off, or a git-ignored `out/` the listing omits. Same rule as
 * {@link useUploadReveal}, minus the toast: hidden-ness is decidable from the path; git-ignored-ness
 * is read off a settled listing that lacks the path (or the nearest ancestor). The reveal writes the
 * SESSION toggles only.
 */
import {useEffect} from "react"

import {ancestorPaths, isHiddenPath, parentOf} from "@agenta/entities/drive"
import {type MountFile} from "@agenta/entities/session"

/** The nearest path on the way to `path` that a loaded, settled listing does not contain. */
export const firstFilteredPath = ({
    path,
    seen,
    loadedDirs,
    fetchingDirs,
}: {
    path: string
    seen: ReadonlySet<string>
    loadedDirs: ReadonlySet<string>
    fetchingDirs: ReadonlySet<string>
}): string | null =>
    [...ancestorPaths(path), path].find((p) => {
        const dir = parentOf(p)
        return !seen.has(p) && loadedDirs.has(dir) && !fetchingDirs.has(dir)
    }) ?? null

export function useSelectionReveal({
    selectedPath,
    files,
    loadedDirs,
    fetchingDirs,
    inGitScope,
    showHidden,
    setShowHidden,
    showGitignored,
    setShowGitignored,
}: {
    selectedPath: string | null
    /** Raw lazy-tree files (pre hidden/origin filtering) — presence here means "the listing has it". */
    files: MountFile[]
    loadedDirs: Set<string>
    fetchingDirs: Set<string>
    inGitScope: boolean
    showHidden: boolean
    setShowHidden: (next: boolean) => void
    showGitignored: boolean
    setShowGitignored: (next: boolean) => void
}) {
    useEffect(() => {
        if (!selectedPath || showHidden || !isHiddenPath(selectedPath)) return
        setShowHidden(true)
    }, [selectedPath, showHidden, setShowHidden])

    useEffect(() => {
        if (!selectedPath || !inGitScope || showGitignored) return
        const seen = new Set(files.map((f) => f.path))
        if (firstFilteredPath({path: selectedPath, seen, loadedDirs, fetchingDirs}))
            setShowGitignored(true)
    }, [
        selectedPath,
        files,
        loadedDirs,
        fetchingDirs,
        inGitScope,
        showGitignored,
        setShowGitignored,
    ])
}
