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
 * Axios (not the Fern client): this endpoint isn't in the generated client, and the drive module
 * already reaches the mounts API directly for its own routes (see `driveMedia.ts`).
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {type MountFile} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
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

async function fetchMountFilePage({
    mountId,
    projectId,
    path,
    cursor,
}: {
    mountId: string
    projectId: string
    path: string
    cursor: string | null
}): Promise<{files: MountFile[]; nextCursor: string | null}> {
    const response = await axios.get(`${getAgentaApiUrl()}/mounts/${mountId}/files/page`, {
        params: {
            project_id: projectId,
            path: path || undefined,
            cursor: cursor || undefined,
            limit: PAGE_LIMIT,
            git_aware: true,
        },
    })
    const data = response.data as {files?: MountFile[]; next_cursor?: string | null}
    return {files: data?.files ?? [], nextCursor: data?.next_cursor ?? null}
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
 * mounts. Resets and reloads when the path (or drive) changes. `loadMore` is safe to call on every
 * scroll tick — it self-guards re-entrancy and end-of-list. `enabled=false` parks it (no sources, no
 * fetch) so it can be lifted to a parent and only fire when the flat view is actually showing.
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
    // A stable identity for "which listing this is" — changing it resets the accumulation.
    const key = useMemo(
        () => sources.map((s) => `${s.mountId}|${s.path}|${s.fold}`).join("__"),
        [sources],
    )

    const [files, setFiles] = useState<MountFile[]>([])
    const [hasMore, setHasMore] = useState(true)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [errored, setErrored] = useState(false)

    // All pagination PROGRESS lives in a ref (not deps) so `loadMore` has a stable identity and never
    // races React state. Replaced wholesale on reset — a fetch that resolves after a reset sees a new
    // object (`prog.current !== st`) and drops its result.
    const prog = useRef<{
        key: string
        srcIdx: number
        cursor: string | null
        inflight: boolean
        any: boolean
    }>({key, srcIdx: 0, cursor: null, inflight: false, any: false})

    const loadMore = useCallback(() => {
        const st = prog.current
        if (st.inflight || !projectId) return
        if (st.srcIdx >= sources.length) {
            setHasMore(false)
            setLoading(false)
            return
        }
        st.inflight = true
        if (st.any) setLoadingMore(true)
        else setLoading(true)
        const src = sources[st.srcIdx]
        fetchMountFilePage({mountId: src.mountId, projectId, path: src.path, cursor: st.cursor})
            .then(({files: page, nextCursor}) => {
                if (prog.current !== st) return // reset happened mid-flight → discard
                if (page.length) {
                    st.any = true
                    const presented = page.map((f) => ({
                        ...f,
                        path: src.fold ? `${src.fold}/${cleanPath(f.path)}` : cleanPath(f.path),
                    }))
                    setFiles((prev) => [...prev, ...presented])
                }
                if (nextCursor) st.cursor = nextCursor
                else {
                    st.srcIdx += 1
                    st.cursor = null
                }
                setHasMore(st.srcIdx < sources.length || Boolean(nextCursor))
                setErrored(false)
            })
            .catch(() => {
                if (prog.current !== st) return
                setErrored(true)
                setHasMore(false)
            })
            .finally(() => {
                if (prog.current !== st) return
                st.inflight = false
                setLoading(false)
                setLoadingMore(false)
            })
    }, [projectId, sources])

    // Reset + kick the first page ONLY when the listing identity (`key`) or project changes — NOT on
    // every `drive`/`sources`/`loadMore` identity churn (the drive object changes when recents update
    // after a turn; resetting then would blow away the scrolled-in list). `key` changes iff the source
    // CONTENT changes, so the closure's `sources` always matches it; the latest `loadMore` is called
    // via a ref so it isn't a stale-closure dep.
    const loadMoreRef = useRef(loadMore)
    loadMoreRef.current = loadMore
    useEffect(() => {
        prog.current = {key, srcIdx: 0, cursor: null, inflight: false, any: false}
        setFiles([])
        setErrored(false)
        setHasMore(sources.length > 0)
        setLoading(sources.length > 0)
        setLoadingMore(false)
        if (sources.length && projectId) loadMoreRef.current()
    }, [key, projectId])

    return {files, loading, loadingMore, hasMore, errored, loadMore}
}
