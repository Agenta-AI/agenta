/**
 * useLazyDriveTree — the drawer's LAZY, per-directory data source. Instead of fetching a mount's whole
 * tree to open the browser (seconds on an 11k-file mount, issue #5367), it loads ONE directory level
 * at a time (`depth=1` + child counts, via `mountDirQueryFamily`): the root is instant, and each
 * folder's contents arrive only when you expand or open it. The whole tree is fetched ONLY when the
 * user searches (search needs everything), and even then on demand.
 *
 * It presents the same accumulated `files: MountFile[]` the tree builder already consumes — so the
 * explorer's `buildDriveTree`/virtualization stay unchanged; only WHERE the files come from changes.
 * The agent's durable mount is folded in under `agent-files/` and each project drive under
 * `drives/<slug>/`, exactly as {@link useSessionDrive} does, so every mount browses as one tree.
 */
import {useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode} from "react"

import {
    cleanPath,
    foldProjectFiles,
    parentOf,
    PROJECT_DRIVES_DIR,
    projectDriveDir,
    resolveProjectDrivePath,
} from "@agenta/entities/drive"
import {AGENT_FILES_DIR, type SessionDriveData} from "@agenta/entities/drive"
import {mountDirQueryFamily, mountFilesQueryFamily, type MountFile} from "@agenta/entities/session"
import {atom, useAtomValue} from "jotai"

/** The fold prefix that maps a mount-RELATIVE path back to its PRESENTED path — "" for the cwd mount,
 * "agent-files/" for the folded agent mount. Derived from (presentedPath, mountRelPath) so it needs no
 * reference to which mount it is: the presented path is the mount-relative path with the fold prepended. */
const foldPrefix = (presentedPath: string, mountRelPath: string): string => {
    let fold = presentedPath.slice(0, presentedPath.length - mountRelPath.length)
    if (fold && !fold.endsWith("/")) fold += "/"
    return fold
}

/** One hidden subscriber per active directory: fetches that level via the shared per-dir query,
 * re-prefixes the mount-relative entries to presented paths, and reports the result up. Renders null —
 * it exists only to hold a query subscription for a directory the explorer currently needs. */
const DirSubscriber = ({
    presentedPath,
    mountId,
    mountPath,
    fold,
    includeGitignored,
    onResult,
}: {
    presentedPath: string
    mountId: string
    mountPath: string
    fold: string
    includeGitignored: boolean
    onResult: (path: string, files: MountFile[] | null, fetching: boolean) => void
}) => {
    const q = useAtomValue(mountDirQueryFamily({mountId, path: mountPath, includeGitignored}))
    const {data, isFetching} = q
    useEffect(() => {
        const mapped = data ? data.map((f) => ({...f, path: `${fold}${cleanPath(f.path)}`})) : null
        onResult(presentedPath, mapped, isFetching)
    }, [presentedPath, data, isFetching, fold, onResult])
    return null
}

export interface LazyDriveTree {
    /** Accumulated entries across every loaded directory (presented paths) — or the full folded tree
     * while searching. Feeds `buildDriveTree` unchanged. */
    files: MountFile[]
    /** Directories whose level is currently in flight (for a per-row/tile "loading" hint). */
    fetchingDirs: Set<string>
    /** Directories whose level has resolved at least once. */
    loadedDirs: Set<string>
    /** The ROOT level hasn't landed yet — the drawer shows its tree/grid skeleton until it does. */
    rootLoading: boolean
    /** The on-demand full-tree fetch (search) is in flight. */
    searchLoading: boolean
    /** Render this (hidden) to drive the per-directory fetches. */
    subscribers: ReactNode
}

/**
 * @param drive        the SUMMARY drive (mount + resolveMount + recents) — cheap, no full-tree fetch.
 * @param activePaths  directories the explorer needs loaded now (root + expanded folders + the open
 *                     folder). New paths mount a subscriber; dropped ones unsubscribe.
 * @param searchActive when true, switch `files` to the full folded tree (fetched on demand).
 */
export function useLazyDriveTree(
    drive: SessionDriveData,
    activePaths: string[],
    searchActive: boolean,
    includeGitignored: boolean,
): LazyDriveTree {
    const cwdMount = drive.mount
    // The agent mount, if the drive folds one in (else resolveMount keeps everything on cwd).
    const agentResolved = drive.resolveMount(AGENT_FILES_DIR)
    const agentMount =
        agentResolved && cwdMount && agentResolved.mount.id !== cwdMount.id
            ? agentResolved.mount
            : null
    const projectDrives = drive.projectDrives ?? NO_PROJECTS
    const projectDirs = useMemo(
        () => projectDrives.map((d) => projectDriveDir(d.slug)),
        [projectDrives],
    )
    // A project drive's folder is the drive's own, never the cwd's: a cwd listing that does not
    // name it (no turn ran yet) must not drop what the drive's own subscription loaded.
    const pinned = useRef(new Set<string>())
    pinned.current = new Set(projectDirs.length ? [PROJECT_DRIVES_DIR, ...projectDirs] : [])

    // Per-directory results, accumulated. A key insight: React reconciles the subscribers by path
    // KEY, so re-deriving the array each render never remounts a stable directory's query.
    const dirFilesRef = useMemo(() => ({map: new Map<string, MountFile[]>()}), [])
    const [dirVersion, forceVersion] = useReducerVersion()
    const [fetchingDirs, setFetching] = useSetState()

    // A drive that leaves the configuration leaves the tree: its cached levels and loading flags go.
    const prevProjectDirs = useRef(projectDirs)
    useEffect(() => {
        const removed = prevProjectDirs.current.filter((d) => !projectDirs.includes(d))
        prevProjectDirs.current = projectDirs
        if (!removed.length) return
        for (const key of [...removed, ...dropDirs(dirFilesRef.map, removed)])
            setFetching(key, false)
        forceVersion()
    }, [projectDirs, dirFilesRef, setFetching, forceVersion])

    const onResult = useCallback(
        (path: string, files: MountFile[] | null, fetching: boolean) => {
            let changed = false
            if (files) {
                // Drop the folder's self row: only its parent's listing says it exists.
                const own = path ? files.filter((f) => cleanPath(f.path) !== path) : files
                dirFilesRef.map.set(path, own)
                // A subfolder this listing no longer names is gone, with everything under it.
                const listed = new Set(own.map((f) => cleanPath(f.path)))
                const keys = [...dirFilesRef.map.keys()]
                const gone = keys.filter(
                    (k) => k && parentOf(k) === path && !listed.has(k) && !pinned.current.has(k),
                )
                for (const k of keys)
                    if (gone.some((g) => k === g || k.startsWith(`${g}/`)))
                        dirFilesRef.map.delete(k)
                changed = true
            }
            setFetching(path, fetching)
            if (changed) forceVersion()
        },
        [dirFilesRef, setFetching, forceVersion],
    )

    // NB: toggling git-ignored visibility re-keys every dir query (includeGitignored is in the key),
    // so each visible directory re-fetches and OVERWRITES its map entry in place — no need to clear
    // the map (which would empty `files`, flip `rootLoading`, and flash the whole drawer to skeleton).
    // A collapsed dir keeps its old (invisible) entry until it's re-opened, which re-fetches it.

    // Full tree of BOTH mounts, folded — ONLY while searching (empty id disables the query otherwise).
    const cwdFullQ = useAtomValue(
        mountFilesQueryFamily({
            mountId: searchActive ? (cwdMount?.id ?? "") : "",
            includeGitignored,
        }),
    )
    const agentFullQ = useAtomValue(
        mountFilesQueryFamily({
            mountId: searchActive && agentMount ? agentMount.id : "",
            includeGitignored,
        }),
    )
    const projectFullAtom = useMemo(
        () =>
            atom((get) =>
                projectDrives.map((d) =>
                    get(
                        mountFilesQueryFamily({
                            mountId: searchActive ? d.mount.id : "",
                            includeGitignored,
                        }),
                    ),
                ),
            ),
        [projectDrives, searchActive, includeGitignored],
    )
    const projectFullQs = useAtomValue(projectFullAtom)
    const fullFiles = useMemo(() => {
        if (!searchActive) return null
        const cwd = (cwdFullQ.data ?? []).filter(
            (f) =>
                cleanPath(f.path) !== AGENT_FILES_DIR &&
                !resolveProjectDrivePath(f.path, projectDrives),
        )
        const agent = (agentFullQ.data ?? []).map((f) => ({
            ...f,
            path: `${AGENT_FILES_DIR}/${cleanPath(f.path)}`,
        }))
        const projects = projectDrives.flatMap((d, i) =>
            foldProjectFiles(d, projectFullQs[i]?.data ?? []),
        )
        return [...cwd, ...agent, ...projects, ...projectFolders(projectDirs)]
    }, [searchActive, cwdFullQ.data, agentFullQ.data, projectDrives, projectDirs, projectFullQs])

    const lazyFiles = useMemo(() => {
        // dirVersion in deps: the ref mutates in place, so bump a version to recompute.
        void dirVersion
        const byPath = new Map<string, MountFile>()
        for (const list of dirFilesRef.map.values()) for (const f of list) byPath.set(f.path, f)
        // Last, so the folder flag wins over the cwd's bare link entry of the same path.
        for (const f of projectFolders(projectDirs)) byPath.set(f.path, f)
        return [...byPath.values()]
    }, [dirFilesRef, dirVersion, projectDirs])

    // Always subscribe to the folded agent mount's ROOT, even while `agent-files` is collapsed — its
    // count/children can't come from the cwd mount (which sees an empty mount-point there), so without
    // this the fold node shows a wrong "0 items" until it's expanded. Each project drive's root too.
    const agentMountId = agentMount?.id ?? null
    const subscriberPaths = useMemo(() => {
        const roots = [...(agentMountId ? [AGENT_FILES_DIR] : []), ...projectDirs]
        const missing = roots.filter((p) => !activePaths.includes(p))
        return missing.length ? [...activePaths, ...missing] : activePaths
    }, [activePaths, agentMountId, projectDirs])

    const subscribers = useMemo(
        () =>
            subscriberPaths.map((p) => {
                const r = drive.resolveMount(p)
                if (!r) return null
                return (
                    <DirSubscriber
                        key={p}
                        presentedPath={p}
                        mountId={r.mount.id}
                        mountPath={r.path}
                        fold={foldPrefix(p, r.path)}
                        includeGitignored={includeGitignored}
                        onResult={onResult}
                    />
                )
            }),
        [subscriberPaths, drive, includeGitignored, onResult],
    )

    // A level no mount backs (the root of a session that has only project drives, or `drives/`
    // there) has nothing to fetch: its entries come from the drives folded under it.
    const loadedDirs = useMemo(() => {
        void dirVersion
        const loaded = new Set(dirFilesRef.map.keys())
        for (const p of ["", ...subscriberPaths]) if (!drive.resolveMount(p)) loaded.add(p)
        return loaded
    }, [dirFilesRef, dirVersion, subscriberPaths, drive])

    return {
        files: searchActive ? (fullFiles ?? []) : lazyFiles,
        fetchingDirs,
        loadedDirs,
        rootLoading: !loadedDirs.has(""),
        searchLoading:
            searchActive &&
            (cwdFullQ.isFetching ||
                agentFullQ.isFetching ||
                projectFullQs.some((q) => q.isFetching)),
        subscribers,
    }
}

// --- tiny state helpers (kept local so the hook reads top-down) --------------------------------

const NO_PROJECTS: NonNullable<SessionDriveData["projectDrives"]> = []

/** Drop every cached level at or under `dirs`; answers the dropped keys. */
export const dropDirs = (map: Map<string, unknown>, dirs: readonly string[]): string[] => {
    const dropped = [...map.keys()].filter((k) =>
        dirs.some((d) => k === d || k.startsWith(`${d}/`)),
    )
    for (const k of dropped) map.delete(k)
    return dropped
}

/** Each project drive's folder, so an empty drive still shows at `drives/<slug>/`. */
const projectFolders = (dirs: string[]): MountFile[] =>
    dirs.map((path) => ({path, is_folder: true}))

/** A monotonically-bumped version, to recompute memos off an in-place-mutated ref. */
function useReducerVersion(): [number, () => void] {
    const [v, bump] = useReducer((n: number) => n + 1, 0)
    return [v, bump]
}

/** A Set<string> membership store with a stable setter that no-ops when unchanged. */
function useSetState(): [Set<string>, (key: string, present: boolean) => void] {
    const [set, setSet] = useState<Set<string>>(() => new Set())
    const update = useCallback((key: string, present: boolean) => {
        setSet((prev) => {
            if (present === prev.has(key)) return prev
            const next = new Set(prev)
            if (present) next.add(key)
            else next.delete(key)
            return next
        })
    }, [])
    return [set, update]
}
