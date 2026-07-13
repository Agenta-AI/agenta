/**
 * App drive data (#5247 `POST /mounts/agents/query`): the agent's ONE durable folder, keyed by
 * the workflow artifact id. Read-never-creates — a mount exists only after a run on a #5247
 * runner, so `null` covers both "backend not deployed yet" and "agent never ran": the App drive
 * row simply stays gated until a mount appears, and lights up by itself once one does.
 *
 * Axios (not Fern) on purpose: the client hasn't been regenerated with `query_agent_mount`;
 * `_ignoreError` keeps the probe silent on deployments without the endpoint. Migrate to the
 * Fern client after regeneration (same note as the PR's own fetcher).
 */
import {useMemo} from "react"

import {mountFilesQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project"

import {driveFiles, driveTotalSize} from "./driveTree"
import type {DriveRecentFile, SessionDriveData} from "./useSessionDrive"

export async function fetchAgentMount({
    artifactId,
    projectId,
}: {
    artifactId: string
    projectId: string
}): Promise<Mount | null> {
    if (!artifactId || !projectId) return null
    try {
        const response = await axios.post<{mounts?: Mount[] | null}>(
            `${getAgentaApiUrl()}/mounts/agents/query`,
            {artifact_id: artifactId},
            {params: {project_id: projectId}, _ignoreError: true} as Record<string, unknown>,
        )
        return response.data.mounts?.[0] ?? null
    } catch {
        return null
    }
}

export const agentMountQueryFamily = atomFamily((artifactId: string) =>
    atomWithQuery<Mount | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: ["mounts", "agent", projectId, artifactId],
            queryFn: () => fetchAgentMount({artifactId, projectId}),
            enabled: Boolean(artifactId && projectId),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * The App drive shaped like {@link SessionDriveData} so every drive surface (drawer, explorer,
 * rows) consumes it unchanged. No recency: agent mounts have no activity signals (and no mtime
 * on the wire) — recents are just the alpha listing.
 */
export function useAgentDrive(artifactId: string): SessionDriveData & {exists: boolean} {
    const mountQuery = useAtomValue(agentMountQueryFamily(artifactId))
    const mount = mountQuery.data ?? null
    const filesQuery = useAtomValue(mountFilesQueryFamily(mount?.id ?? ""))

    return useMemo(() => {
        const listing = filesQuery.data ?? null
        const files = driveFiles(listing)
        const recents: DriveRecentFile[] = [...files].sort((a, b) => a.path.localeCompare(b.path))
        const isLoading =
            Boolean(artifactId) && (mountQuery.isPending || Boolean(mount && filesQuery.isPending))
        const errored = Boolean(mount) && !filesQuery.isPending && listing === null

        return {
            mount,
            exists: Boolean(mount),
            files,
            fileCount: files.length,
            totalSize: driveTotalSize(listing),
            recents,
            // Single-mount drive: every path maps straight to this mount.
            resolveMount: (path: string) =>
                mount ? {mount, path: path.replace(/^\/+|\/+$/g, "")} : null,
            lastTouchedAt: null,
            summary: isLoading
                ? "…"
                : !mount
                  ? "Coming soon"
                  : errored
                    ? "Unavailable"
                    : files.length === 0
                      ? "No files yet"
                      : `${files.length} file${files.length === 1 ? "" : "s"}`,
            isLoading,
            errored,
        }
    }, [artifactId, mount, mountQuery.isPending, filesQuery.data, filesQuery.isPending])
}
