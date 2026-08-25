/**
 * useDriveTreeData — the pipeline from (drive + filters + expanded set) to the rows the tree pane
 * renders: which directories to keep loaded, the LAZY per-directory load, the origin/hidden/search
 * filtering, the built tree (with in-flight uploads folded in), the flattened visible rows + their
 * path→index map, the per-path node lookup, and the one-shot reveal sets. Pure derivation — it owns
 * no user intent.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    buildDriveTree,
    filterDriveTree,
    isHiddenPath,
    type DriveTreeNode,
} from "@agenta/entities/drive"
import {
    EMPTY_STR_SET,
    collectFolderPaths,
    flattenTree,
    looksLikeFilePath,
} from "@agenta/entities/drive"
import {fileOrigin, type FileOrigin, type SessionDriveData} from "@agenta/entities/drive"
import {type MountFile} from "@agenta/entities/session"

import {useLazyDriveTree} from "./useLazyDriveTree"

export function useDriveTreeData({
    drive,
    explicitFiles,
    uploadFiles,
    expanded,
    selectedPath,
    searchActive,
    deferredSearch,
    originFilter,
    showHidden,
    showGitignored,
}: {
    drive: SessionDriveData
    /** Local-file mode: this flat list IS the tree; the mount's lazy files are ignored. */
    explicitFiles?: MountFile[]
    /** In-flight uploads as synthetic files, nested under their destination folder by the builder. */
    uploadFiles: MountFile[]
    expanded: Set<string>
    selectedPath: string | null
    searchActive: boolean
    deferredSearch: string
    originFilter: "all" | FileOrigin
    showHidden: boolean
    showGitignored: boolean
}) {
    // Whether the SELECTION is a folder — the backend's `is_folder` answers it as soon as the
    // selection's own level is present in the tree, so the name heuristic below covers only the cold
    // window before that (a restored deep path, nothing loaded yet). Adjusted during render, not in an
    // effect, so a wrong guess is corrected BEFORE its directory subscriber ever mounts.
    const [knownKind, setKnownKind] = useState<{path: string; isFolder: boolean} | null>(null)
    const selectionIsFolder =
        selectedPath == null
            ? false
            : knownKind?.path === selectedPath
              ? knownKind.isFolder
              : !looksLikeFilePath(selectedPath)
    // Directories to keep loaded: the root, every expanded folder, and the OPEN folder — which stays
    // subscribed even when its tree row is collapsed, since the content pane is still showing it. A
    // selected FILE needs no directory; its preview reads by path.
    const activePaths = useMemo(() => {
        const set = new Set<string>([""])
        for (const p of expanded) set.add(p)
        if (selectedPath && selectionIsFolder) set.add(selectedPath)
        return [...set]
    }, [expanded, selectedPath, selectionIsFolder])
    // LAZY: load one directory level at a time (root instant, each folder on demand) instead of the
    // whole-tree fetch that blocked the drawer open on huge mounts (#5367). Falls back to the full
    // folded tree ONLY while searching. The tree builder below consumes its accumulated `files`.
    const lazyTree = useLazyDriveTree(drive, activePaths, searchActive, showGitignored)
    // "In git scope" = a `.gitignore` sits in this folder or any ancestor (a `.gitignore` is itself
    // never gitignored, so it always shows in the listing). Only then does the "show git-ignored"
    // toggle make sense — there's something being hidden. Uses raw lazy files (pre hidden/origin
    // filter) so it holds even with hidden files off.
    const inGitScope = useMemo(() => {
        const ancestors = new Set<string>([""])
        if (selectedPath) {
            const segs = selectedPath.split("/")
            for (let i = 1; i <= segs.length; i++) ancestors.add(segs.slice(0, i).join("/"))
        }
        return lazyTree.files.some((f) => {
            const slash = f.path.lastIndexOf("/")
            const dir = slash === -1 ? "" : f.path.slice(0, slash)
            const name = slash === -1 ? f.path : f.path.slice(slash + 1)
            return name === ".gitignore" && ancestors.has(dir)
        })
    }, [lazyTree.files, selectedPath])
    const originFiltered = useMemo(() => {
        // Local-file mode: the explicit list is the whole tree; the mount's lazy files are ignored.
        let files = explicitFiles ?? lazyTree.files
        if (originFilter !== "all") files = files.filter((f) => fileOrigin(f.path) === originFilter)
        if (!showHidden) files = files.filter((f) => !isHiddenPath(f.path))
        return files
    }, [explicitFiles, lazyTree.files, originFilter, showHidden])
    const tree = useMemo(
        () =>
            buildDriveTree(
                uploadFiles.length ? [...originFiltered, ...uploadFiles] : originFiltered,
            ),
        [originFiltered, uploadFiles],
    )
    const shownTree = useMemo(() => filterDriveTree(tree, deferredSearch), [tree, deferredSearch])
    // While searching, show every surviving branch expanded so matches are visible.
    const shownExpanded = useMemo(
        () => (deferredSearch.trim() ? new Set(collectFolderPaths(shownTree)) : expanded),
        [deferredSearch, shownTree, expanded],
    )
    // A folder is "loading" once expanded but its level hasn't resolved yet (or is refetching) — the
    // cue for flattenTree's shimmer rows and the row spinner. Not while searching (the whole tree is
    // fetched in one shot then, so per-folder placeholders would be wrong).
    const isDirLoading = useCallback(
        (path: string) =>
            // Only shimmer until a folder's FIRST load — a background refetch (e.g. after an upload)
            // keeps the current tiles/rows on screen instead of flashing a skeleton.
            !explicitFiles && !searchActive && !lazyTree.loadedDirs.has(path),
        [explicitFiles, searchActive, lazyTree.loadedDirs],
    )
    // The visible rows, flattened for virtualization (see flattenTree), plus a path→row-index map for
    // O(1) keyboard navigation.
    const flatRows = useMemo(
        () => flattenTree(shownTree, shownExpanded, isDirLoading),
        [shownTree, shownExpanded, isDirLoading],
    )
    const indexByPath = useMemo(() => {
        const map = new Map<string, number>()
        // Skip synthetic loading rows — they carry sentinel paths and are never a nav/selection target.
        flatRows.forEach((r, i) => {
            if (!r.loading) map.set(r.node.path, i)
        })
        return map
    }, [flatRows])
    // Dirs whose level resolved on THIS render (vs the previous COMMITTED one) — so the freshly-appearing
    // child rows carry their entrance `initial` on the exact render they mount, then it's empty again.
    // That one-shot gate is what staggers the reveal in gracefully WITHOUT re-firing every time the
    // virtualizer remounts a row on scroll. The ref is advanced in an effect (NOT during render) so the
    // diff survives StrictMode's double-render, where a write-during-render would cancel itself out.
    const prevLoadedRef = useRef<ReadonlySet<string>>(EMPTY_STR_SET)
    let justLoadedDirs: ReadonlySet<string> = EMPTY_STR_SET
    if (lazyTree.loadedDirs !== prevLoadedRef.current) {
        const prev = prevLoadedRef.current
        const fresh = new Set<string>()
        lazyTree.loadedDirs.forEach((d) => {
            if (!prev.has(d)) fresh.add(d)
        })
        if (fresh.size) justLoadedDirs = fresh
    }
    useEffect(() => {
        prevLoadedRef.current = lazyTree.loadedDirs
    }, [lazyTree.loadedDirs])
    // Every path ever shown (never pruned on collapse), so a row appearing in an ALREADY-loaded folder
    // — an upload landing via the silent revalidate — is recognised as first-ever and fades in, while
    // a cached folder's re-expand (paths seen before) does not. First loads are covered by
    // justLoadedDirs above; this only adds the "new file in an open folder" case.
    const everSeenRef = useRef<Set<string>>(new Set())
    const firstEverPaths = useMemo(() => {
        const fresh = new Set<string>()
        for (const r of flatRows) {
            if (!r.loading && !everSeenRef.current.has(r.node.path)) fresh.add(r.node.path)
        }
        return fresh
    }, [flatRows])
    useEffect(() => {
        for (const r of flatRows) if (!r.loading) everSeenRef.current.add(r.node.path)
    }, [flatRows])
    // Flat lookup of every tree node by path, so a selected FOLDER can render its children (folder
    // view) and a selected FILE the preview. Root ("") maps to the top-level nodes.
    const nodeByPath = useMemo(() => {
        const map = new Map<string, DriveTreeNode>()
        const walk = (nodes: DriveTreeNode[]) => {
            for (const n of nodes) {
                map.set(n.path, n)
                if (n.children.length) walk(n.children)
            }
        }
        walk(tree)
        return map
    }, [tree])
    // …which is where the selection's real kind comes from: once its node is in the tree, replace the
    // name guess above with the backend's flag. Render-phase update — React re-runs this render with
    // the corrected `activePaths`, so a misjudged path never gets a directory query.
    const selectedIsFolderNode = selectedPath ? nodeByPath.get(selectedPath)?.isFolder : undefined
    if (
        selectedPath &&
        selectedIsFolderNode !== undefined &&
        (knownKind?.path !== selectedPath || knownKind.isFolder !== selectedIsFolderNode)
    ) {
        setKnownKind({path: selectedPath, isFolder: selectedIsFolderNode})
    }
    return {
        lazyTree,
        inGitScope,
        tree,
        shownExpanded,
        isDirLoading,
        flatRows,
        indexByPath,
        justLoadedDirs,
        firstEverPaths,
        nodeByPath,
    }
}
