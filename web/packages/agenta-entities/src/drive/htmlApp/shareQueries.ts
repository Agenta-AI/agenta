/**
 * Query atoms for app sharing: the owner's share state for one app, and a viewer's snapshot.
 */
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    fetchAppShare,
    fetchSharedApp,
    type AppShareResult,
    type SharedAppSnapshot,
} from "./share"

export const appShareQueryKey = (projectId: string, mountId: string, path: string) =>
    ["mounts", "app-share", projectId, mountId, path] as const

/** The share state of one app folder, for the owner's dialog. */
export const appShareQueryFamily = atomFamily(
    ({projectId, mountId, path}: {projectId: string; mountId: string; path: string}) =>
        atomWithQuery<AppShareResult>(() => ({
            queryKey: appShareQueryKey(projectId, mountId, path),
            queryFn: () => fetchAppShare({projectId, mountId, path}),
            enabled: Boolean(projectId && mountId && path),
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.projectId === b.projectId && a.mountId === b.mountId && a.path === b.path,
)

/**
 * One version of a shared app. Never cached across mounts (`gcTime: 0`): a stopped share must
 * stop on the next open, and the snapshot can be 25 MB.
 */
export const sharedAppQueryFamily = atomFamily(
    ({token, version}: {token: string; version: number | null}) =>
        atomWithQuery<SharedAppSnapshot>(() => ({
            queryKey: ["shared-app", token, version],
            queryFn: () => fetchSharedApp({token, version}),
            enabled: Boolean(token),
            staleTime: Infinity,
            gcTime: 0,
            retry: false,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.token === b.token && a.version === b.version,
)
