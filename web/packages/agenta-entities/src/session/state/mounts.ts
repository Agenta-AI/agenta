/**
 * Centralized query state for mounts (drives) — the single data source every mount surface
 * shares (config-panel Session drive, chat right-panel Mounts tab, SessionInspector).
 *
 * Why atoms instead of per-component useQuery: (1) all surfaces dedupe onto one cache entry per
 * key; (2) OTHER chains can trigger revalidation — there is no live backend channel for mount
 * changes, so the chat invalidates after each finished turn via {@link revalidateSessionMountsAtom}
 * and any surface (open now or expanded later) picks the fresh listing up; (3) fetch behavior
 * (priority, staleTime) is tuned in exactly one place. All reads are low-priority — mounts are
 * never render-critical.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {
    queryLatestMountFiles,
    queryMountDir,
    queryMountFiles,
    querySessionMounts,
    readMountFile,
    type MountFilesPage,
} from "../api/api"
import type {Mount, MountFile} from "../core/schema"

// Query keys, factored so the revalidate atom and the families can never drift.
export const sessionMountsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "mounts", projectId, sessionId] as const
export const mountFilesQueryKey = (projectId: string, mountId: string, includeGitignored = false) =>
    ["mounts", "files", projectId, mountId, includeGitignored] as const
export const latestMountFilesQueryKey = (
    projectId: string,
    mountId: string,
    order: string,
    limit: number,
) => ["mounts", "files-latest", projectId, mountId, order, limit] as const
export const mountFileContentQueryKey = (projectId: string, mountId: string, path: string) =>
    ["mounts", "file", projectId, mountId, path] as const
export const mountRootQueryKey = (projectId: string, mountId: string) =>
    ["mounts", "files-root", projectId, mountId] as const
export const mountDirQueryKey = (
    projectId: string,
    mountId: string,
    path: string,
    includeGitignored = false,
) => ["mounts", "files-dir", projectId, mountId, path, includeGitignored] as const

/** The mounts (drives) bound to one session. */
export const sessionMountsQueryFamily = atomFamily((sessionId: string) =>
    atomWithQuery<Mount[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: sessionMountsQueryKey(projectId, sessionId),
            queryFn: ({signal}) =>
                querySessionMounts({sessionId, projectId, abortSignal: signal, lowPriority: true}),
            enabled: Boolean(sessionId && projectId),
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/** One mount's full file tree (folded to a one-level view client-side via `deriveMountRows`).
 * `includeGitignored` (default false) surfaces `.gitignore`d files too — the drawer's search uses it
 * when the "show git-ignored files" toggle is on. */
export const mountFilesQueryFamily = atomFamily(
    ({mountId, includeGitignored = false}: {mountId: string; includeGitignored?: boolean}) =>
        atomWithQuery<MountFile[] | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: mountFilesQueryKey(projectId, mountId, includeGitignored),
                queryFn: ({signal}) =>
                    queryMountFiles({
                        mountId,
                        projectId,
                        includeGitignored,
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                enabled: Boolean(mountId && projectId),
                staleTime: 30_000,
                refetchOnWindowFocus: false,
            }
        }),
    (a, b) =>
        a.mountId === b.mountId && Boolean(a.includeGitignored) === Boolean(b.includeGitignored),
)

/**
 * The latest N files of a mount (backend-sorted + limited), for the summary surfaces that show a
 * handful of recent files. Unlike {@link mountFilesQueryFamily} this never pulls the whole tree into
 * the client, so it scales past tens of thousands of files.
 */
export const latestMountFilesQueryFamily = atomFamily(
    ({
        mountId,
        limit,
        order,
    }: {
        mountId: string
        limit: number
        order?: "recent" | "name" | "path"
    }) =>
        atomWithQuery<MountFilesPage | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: latestMountFilesQueryKey(projectId, mountId, order ?? "none", limit),
                queryFn: ({signal}) =>
                    queryLatestMountFiles({
                        mountId,
                        projectId,
                        order,
                        limit,
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                enabled: Boolean(mountId && projectId),
                staleTime: 30_000,
                refetchOnWindowFocus: false,
            }
        }),
    (a, b) => a.mountId === b.mountId && a.limit === b.limit && a.order === b.order,
)

/**
 * A mount's TOP-LEVEL entries only (`depth=1` — one server-side delimiter listing), for the summary
 * surfaces to show "what's in this drive" when the record log holds no recent changes. Constant cost
 * regardless of tree size, so it's safe to run from the always-mounted chrome.
 */
export const mountRootQueryFamily = atomFamily((mountId: string) =>
    atomWithQuery<MountFile[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: mountRootQueryKey(projectId, mountId),
            queryFn: ({signal}) =>
                queryMountDir({
                    mountId,
                    projectId,
                    path: "",
                    abortSignal: signal,
                    lowPriority: true,
                }),
            enabled: Boolean(mountId && projectId),
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * ONE directory level of a mount (`depth=1`, WITH folder child-counts) — the unit the lazy drawer
 * loads as you navigate. Keyed by `(mountId, path)` so every visited directory caches independently;
 * opening a huge mount fetches only the root, and each folder its own level on demand. `path=""` is
 * the root. Distinct from {@link mountRootQueryFamily} (the count-free summary root).
 */
export const mountDirQueryFamily = atomFamily(
    ({
        mountId,
        path,
        includeGitignored = false,
    }: {
        mountId: string
        path: string
        /** Include `.gitignore`d entries too (the "show git-ignored files" toggle). */
        includeGitignored?: boolean
    }) =>
        atomWithQuery<MountFile[] | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: mountDirQueryKey(projectId, mountId, path, includeGitignored),
                queryFn: ({signal}) =>
                    queryMountDir({
                        mountId,
                        projectId,
                        path,
                        withCounts: true,
                        includeGitignored,
                        abortSignal: signal,
                        lowPriority: true,
                    }),
                enabled: Boolean(mountId && projectId),
                staleTime: 30_000,
                refetchOnWindowFocus: false,
            }
        }),
    (a, b) =>
        a.mountId === b.mountId &&
        a.path === b.path &&
        Boolean(a.includeGitignored) === Boolean(b.includeGitignored),
)

/** One mount file's text content. Bodies can be ~1.5 MB strings, so retention is short:
 * a minute after the last viewer unmounts the string is dropped (refetch is cheap). */
export const mountFileContentQueryFamily = atomFamily(
    ({mountId, path}: {mountId: string; path: string}) =>
        atomWithQuery<string | null>((get) => {
            const projectId = get(projectIdAtom) ?? ""
            return {
                queryKey: mountFileContentQueryKey(projectId, mountId, path),
                queryFn: ({signal}) =>
                    readMountFile({mountId, projectId, abortSignal: signal, path}),
                enabled: Boolean(mountId && path && projectId),
                staleTime: 30_000,
                gcTime: 60_000,
                refetchOnWindowFocus: false,
            }
        }),
    (a, b) => a.mountId === b.mountId && a.path === b.path,
)

/**
 * Mark one session's drive data stale: the mount list, plus the file listing and file contents
 * of every mount already known to belong to it. Active (mounted) queries refetch immediately;
 * inactive ones refetch on next expand — which is exactly the "opened the drive before the run,
 * reopen after" staleness fix. Fire-and-forget: call after any event that may have changed files
 * (a finished turn today; specific stream events later).
 */
export const revalidateSessionMountsAtom = atom(null, (get, _set, sessionId: string) => {
    const projectId = get(projectIdAtom) ?? ""
    if (!projectId || !sessionId) return
    const queryClient = get(queryClientAtom)

    // `cancelRefetch: false` — a turn streaming/finishing (incl. the SDK auto-resuming the last turn
    // on reload) fires this while the FIRST mount fetch may still be in flight; the default would
    // CANCEL that in-flight request and start another (the duplicate `?…&limit=5` seen on reload).
    // An in-flight fetch already returns fresh data, so let it finish and only refetch settled ones.
    const opts = {cancelRefetch: false} as const

    // The session's mount LIST (a run can add a mount).
    void queryClient.invalidateQueries(
        {queryKey: sessionMountsQueryKey(projectId, sessionId)},
        opts,
    )
    // Every mount's file listing + bodies for the project (prefix match). This covers the session
    // cwd mounts AND the artifact-scoped agent mount folded into the session drive under
    // `agent-files/`: the agent mount is keyed by ARTIFACT, not session, so a per-session loop
    // missed it — files written there stayed stale until a reload. Inactive queries just refetch on
    // next open; active ones (the open drive) refetch now (unless already fetching).
    void queryClient.invalidateQueries({queryKey: ["mounts", "files", projectId]}, opts)
    void queryClient.invalidateQueries({queryKey: ["mounts", "files-latest", projectId]}, opts)
    void queryClient.invalidateQueries({queryKey: ["mounts", "files-root", projectId]}, opts)
    void queryClient.invalidateQueries({queryKey: ["mounts", "files-dir", projectId]}, opts)
    void queryClient.invalidateQueries({queryKey: ["mounts", "file", projectId]}, opts)
    // The agent-mount lookup itself (`agentDrive` key), in case the first write just created it.
    void queryClient.invalidateQueries({queryKey: ["mounts", "agent", projectId]}, opts)
})
