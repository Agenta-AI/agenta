/**
 * useLazyDriveTree — the drawer's LAZY, per-directory data source. Instead of fetching a mount's whole
 * tree to open the browser (seconds on an 11k-file mount, issue #5367), it loads ONE directory level
 * at a time (`depth=1` + child counts, via `mountDirQueryFamily`): the root is instant, and each
 * folder's contents arrive only when you expand or open it. The whole tree is fetched ONLY when the
 * user searches (search needs everything), and even then on demand.
 *
 * It presents the same accumulated `files: MountFile[]` the tree builder already consumes — so the
 * explorer's `buildDriveTree`/virtualization stay unchanged; only WHERE the files come from changes.
 * The agent's durable mount is folded in under `agent-files/` exactly as {@link useSessionDrive} does,
 * so both mounts browse as one tree.
 */
import {useCallback, useEffect, useMemo, useReducer, useState, type ReactNode} from "react"

import {mountDirQueryFamily, mountFilesQueryFamily, type MountFile} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {cleanPath} from "./driveTree"
import {AGENT_FILES_DIR, type SessionDriveData} from "./useSessionDrive"

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

    // Per-directory results, accumulated. A key insight: React reconciles the subscribers by path
    // KEY, so re-deriving the array each render never remounts a stable directory's query.
    const dirFilesRef = useMemo(() => ({map: new Map<string, MountFile[]>()}), [])
    const [dirVersion, forceVersion] = useReducerVersion()
    const [fetchingDirs, setFetching] = useSetState()

    const onResult = useCallback(
        (path: string, files: MountFile[] | null, fetching: boolean) => {
            let changed = false
            if (files) {
                dirFilesRef.map.set(path, files)
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
    const fullFiles = useMemo(() => {
        if (!searchActive) return null
        const cwd = (cwdFullQ.data ?? []).filter((f) => cleanPath(f.path) !== AGENT_FILES_DIR)
        const agent = (agentFullQ.data ?? []).map((f) => ({
            ...f,
            path: `${AGENT_FILES_DIR}/${cleanPath(f.path)}`,
        }))
        return [...cwd, ...agent]
    }, [searchActive, cwdFullQ.data, agentFullQ.data])

    const lazyFiles = useMemo(() => {
        // dirVersion in deps: the ref mutates in place, so bump a version to recompute.
        void dirVersion
        const byPath = new Map<string, MountFile>()
        for (const list of dirFilesRef.map.values()) for (const f of list) byPath.set(f.path, f)
        return [...byPath.values()]
    }, [dirFilesRef, dirVersion])

    // Always subscribe to the folded agent mount's ROOT, even while `agent-files` is collapsed — its
    // count/children can't come from the cwd mount (which sees an empty mount-point there), so without
    // this the fold node shows a wrong "0 items" until it's expanded.
    const agentMountId = agentMount?.id ?? null
    const subscriberPaths = useMemo(
        () =>
            agentMountId && !activePaths.includes(AGENT_FILES_DIR)
                ? [...activePaths, AGENT_FILES_DIR]
                : activePaths,
        [activePaths, agentMountId],
    )

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

    const loadedDirs = useMemo(() => {
        void dirVersion
        return new Set(dirFilesRef.map.keys())
    }, [dirFilesRef, dirVersion])

    return {
        files: searchActive ? (fullFiles ?? []) : lazyFiles,
        fetchingDirs,
        loadedDirs,
        rootLoading: !loadedDirs.has(""),
        searchLoading: searchActive && (cwdFullQ.isFetching || agentFullQ.isFetching),
        subscribers,
    }
}

// --- tiny state helpers (kept local so the hook reads top-down) --------------------------------

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
