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

import {queryMountFiles, querySessionMounts, readMountFile} from "../api/api"
import type {Mount, MountFile} from "../core/schema"

// Query keys, factored so the revalidate atom and the families can never drift.
export const sessionMountsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "mounts", projectId, sessionId] as const
export const mountFilesQueryKey = (projectId: string, mountId: string) =>
    ["mounts", "files", projectId, mountId] as const
export const mountFileContentQueryKey = (projectId: string, mountId: string, path: string) =>
    ["mounts", "file", projectId, mountId, path] as const

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

/** One mount's full file tree (folded to a one-level view client-side via `deriveMountRows`). */
export const mountFilesQueryFamily = atomFamily((mountId: string) =>
    atomWithQuery<MountFile[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: mountFilesQueryKey(projectId, mountId),
            queryFn: ({signal}) =>
                queryMountFiles({mountId, projectId, abortSignal: signal, lowPriority: true}),
            enabled: Boolean(mountId && projectId),
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        }
    }),
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

    // The session's mount LIST (a run can add a mount).
    void queryClient.invalidateQueries({queryKey: sessionMountsQueryKey(projectId, sessionId)})
    // Every mount's file listing + bodies for the project (prefix match). This covers the session
    // cwd mounts AND the artifact-scoped agent mount folded into the session drive under
    // `agent-files/`: the agent mount is keyed by ARTIFACT, not session, so a per-session loop
    // missed it — files written there stayed stale until a reload. Inactive queries just refetch on
    // next open; active ones (the open drive) refetch now.
    void queryClient.invalidateQueries({queryKey: ["mounts", "files", projectId]})
    void queryClient.invalidateQueries({queryKey: ["mounts", "file", projectId]})
    // The agent-mount lookup itself (`agentDrive` key), in case the first write just created it.
    void queryClient.invalidateQueries({queryKey: ["mounts", "agent", projectId]})
})
