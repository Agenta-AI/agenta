/**
 * driveFlatFiles — the data layer for the drawer's FLAT view: EVERY file under the current path,
 * pulled out of its folders, loaded by CURSOR PAGINATION so first paint is fast no matter how large
 * the mount is (a multi-GB session cwd never blocks on a whole-tree enumeration — issue #5367).
 *
 * The backend `GET /mounts/{id}/files/page` streams path-sorted pages (`next_cursor` opaque token),
 * pruning `.git`/gitignored/internal and jumping past ignored directories (never paging a
 * `node_modules` dump). This hook drives it across the drive's FOLDED mounts (cwd at the root, the
 * agent's durable mount under `agent-files/`), presenting one accumulating, path-scoped file list.
 *
 * Transport: the Fern client via `@agenta/entities/session`'s `queryMountFilePage`, paginated with
 * TanStack Query's `useInfiniteQuery` (shared QueryClient) — no raw axios, no hand-rolled fetch loop.
 * The two folded mounts are threaded through ONE cursor chain via a `{srcIdx, cursor}` page param.
 */
import {useCallback, useMemo} from "react"

import {queryMountFilePage, type MountFile} from "@agenta/entities/session"
import {useInfiniteQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {cleanPath} from "./driveTree"
import {AGENT_FILES_DIR, type SessionDriveData} from "./useSessionDrive"

/** How many files per page request. Small enough that the first page paints fast; the virtualized
 * list requests more as you scroll. */
const PAGE_LIMIT = 100

/** One paginated source: a mount + a mount-relative scope `path`, presented under `fold` (""=cwd,
 * "agent-files" for the folded agent mount). The flat list concatenates its sources in order. */
interface FlatSource {
    mountId: string
    path: string
    fold: string
}

/** Infinite-query page cursor: WHICH folded source (`srcIdx`) and its opaque store `cursor`. Threads
 * the two mounts through a single page chain — `getNextPageParam` advances `srcIdx` when a source's
 * cursor runs out. */
interface FlatPageParam {
    srcIdx: number
    cursor: string | null
}

/** The folded mounts covering a presented `path`: at the root, the cwd mount + the agent mount
 * (folded under `agent-files/`); inside a folder, just the single mount that path resolves to. */
export function flatSources(drive: SessionDriveData, presentedPath: string): FlatSource[] {
    const cwd = drive.mount
    const agentResolved = drive.resolveMount(AGENT_FILES_DIR)
    const agentMount =
        agentResolved && cwd && agentResolved.mount.id !== cwd.id ? agentResolved.mount : null

    const path = cleanPath(presentedPath ?? "")
    if (!path) {
        const sources: FlatSource[] = []
        if (cwd?.id) sources.push({mountId: cwd.id, path: "", fold: ""})
        if (agentMount) sources.push({mountId: agentMount.id, path: "", fold: AGENT_FILES_DIR})
        return sources
    }
    const resolved = drive.resolveMount(path)
    if (!resolved?.mount?.id) return []
    // The fold prefix is the presented path minus its mount-relative tail (e.g. "agent-files").
    const fold = cleanPath(path.slice(0, path.length - resolved.path.length))
    return [{mountId: resolved.mount.id, path: resolved.path, fold}]
}

export interface FlatFilesInfinite {
    /** Files loaded so far (presented paths), in path order per source, sources concatenated. */
    files: MountFile[]
    /** The FIRST page is in flight and nothing has painted yet — show the skeleton. */
    loading: boolean
    /** A follow-up page is in flight — show the footer spinner (the list is already visible). */
    loadingMore: boolean
    /** More pages remain (this source or a later one). */
    hasMore: boolean
    errored: boolean
    /** Request the next page — idempotent while a request is in flight or the list is exhausted. */
    loadMore: () => void
}

/**
 * Cursor-paginated flat listing of every file under `presentedPath`, across the drive's folded
 * mounts. Backed by `useInfiniteQuery`: the query KEY encodes the source identity, so navigating to a
 * new folder starts a fresh listing while reopening the SAME scope repaints from cache (instant
 * "Back"); TanStack Query owns in-flight de-dup, retry, and the loading flags. `loadMore` is safe to
 * call on every scroll tick (it self-guards on `hasNextPage`/in-flight). `enabled=false` parks it (no
 * sources → the query is disabled) so it can be lifted to a parent and only fire when flat is showing.
 */
export function useFlatFilesInfinite(
    drive: SessionDriveData,
    presentedPath: string,
    enabled = true,
): FlatFilesInfinite {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const sources = useMemo(
        () => (enabled ? flatSources(drive, presentedPath) : []),
        [enabled, drive, presentedPath],
    )
    // A stable identity for "which listing this is" — part of the query key, so it changes iff the
    // source CONTENT changes (NOT on `drive` identity churn when recents update after a turn).
    const key = useMemo(
        () => sources.map((s) => `${s.mountId}|${s.path}|${s.fold}`).join("__"),
        [sources],
    )

    const query = useInfiniteQuery({
        queryKey: ["mounts", "flat-page", projectId, key],
        enabled: Boolean(projectId) && sources.length > 0,
        initialPageParam: {srcIdx: 0, cursor: null} as FlatPageParam,
        queryFn: async ({pageParam, signal}) => {
            const src = sources[pageParam.srcIdx]
            const page = await queryMountFilePage({
                mountId: src.mountId,
                projectId,
                path: src.path || undefined,
                cursor: pageParam.cursor,
                limit: PAGE_LIMIT,
                abortSignal: signal,
            })
            // `queryMountFilePage` returns null on a real (non-abort) failure — throw so the query
            // enters its error state (and the footer's retry can re-run this exact page).
            if (!page) throw new Error("Failed to load mount file page")
            // Present each mount-relative path under its fold prefix ("agent-files/…" for the folded
            // agent mount; bare for cwd), so both sources read as one path-scoped list.
            const files = page.files.map((f) => ({
                ...f,
                path: src.fold ? `${src.fold}/${cleanPath(f.path)}` : cleanPath(f.path),
            }))
            return {files, nextCursor: page.nextCursor, srcIdx: pageParam.srcIdx}
        },
        // Chain within a source until its cursor runs out, then step to the next folded source.
        getNextPageParam: (lastPage): FlatPageParam | undefined => {
            if (lastPage.nextCursor) return {srcIdx: lastPage.srcIdx, cursor: lastPage.nextCursor}
            const next = lastPage.srcIdx + 1
            return next < sources.length ? {srcIdx: next, cursor: null} : undefined
        },
        // One page is a bounded slice (not the whole-tree LIST) and the entity already retries once at
        // the Fern layer, so keep the query-level retry to a single extra attempt.
        retry: 1,
        // Reopening the same scope should paint instantly from cache (the "instant Back" the lifted
        // hook exists for); a genuine reset rides the query key (folder navigation), not a refetch.
        staleTime: 30_000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    })

    const files = useMemo(() => query.data?.pages.flatMap((p) => p.files) ?? [], [query.data])

    const {hasNextPage, isFetchingNextPage, fetchNextPage} = query
    const loadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    return {
        files,
        loading: query.isLoading,
        loadingMore: isFetchingNextPage,
        hasMore: Boolean(hasNextPage),
        errored: query.isError,
        loadMore,
    }
}
