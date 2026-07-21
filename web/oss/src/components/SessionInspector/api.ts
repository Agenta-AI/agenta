import {getMountsClient, getSessionsClient} from "@agenta/sdk/resources"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

const scope = (projectId?: string | null) =>
    projectId ? {queryParams: {project_id: projectId}} : undefined

// Fern types getMountFiles as `unknown`; declare the shapes locally.
export interface MountFileEntry {
    path: string
    size: number
    is_folder: boolean
}

export interface MountFileListing {
    count: number
    files: MountFileEntry[]
}

export interface MountFileText {
    path: string
    content: string
}

export async function fetchStream(sessionId: string, projectId?: string | null) {
    const res = await getSessionsClient().fetchSessionStream(
        {session_id: sessionId},
        scope(projectId),
    )
    return res.stream ?? null
}

export async function fetchRecords(sessionId: string, projectId?: string | null) {
    return getSessionsClient().queryRecords({session_id: sessionId}, scope(projectId))
}

export async function fetchState(sessionId: string, projectId?: string | null) {
    const res = await getSessionsClient().getState({session_id: sessionId}, scope(projectId))
    return res.session_state ?? null
}

export async function fetchMounts(sessionId: string, projectId?: string | null) {
    return getSessionsClient().querySessionMounts({session_id: sessionId}, scope(projectId))
}

// Fern has no query_agent_mount yet; migrate after client regeneration.
export async function fetchAgentMount(artifactId: string, projectId?: string | null) {
    const res = await axios.post<Awaited<ReturnType<typeof fetchMounts>>>(
        `${getAgentaApiUrl()}/mounts/agents/query`,
        {artifact_id: artifactId},
        {params: {project_id: projectId}, _ignoreError: true} as Record<string, unknown>,
    )
    return res.data.mounts?.[0] ?? null
}

export async function fetchMountFiles(
    mountId: string,
    projectId?: string | null,
    path?: string,
): Promise<MountFileListing> {
    const data = await getMountsClient().getMountFiles({mount_id: mountId, path}, scope(projectId))
    return data as MountFileListing
}

export async function fetchMountFileText(
    mountId: string,
    projectId: string | null | undefined,
    path: string,
): Promise<MountFileText> {
    const data = await getMountsClient().getMountFiles(
        {mount_id: mountId, read: path},
        scope(projectId),
    )
    return data as MountFileText
}

/** Binary body — the Fern client always parses the response as JSON, so it can't yield a Blob. */
export async function fetchMountFileBlob(
    mountId: string,
    projectId: string | null | undefined,
    path: string,
): Promise<Blob> {
    const res = await axios.get<Blob>(`${getAgentaApiUrl()}/mounts/${mountId}/files/download`, {
        params: {path, project_id: projectId},
        responseType: "blob",
    })
    return res.data
}

export async function fetchInteractions(sessionId: string, projectId?: string | null) {
    return getSessionsClient().queryInteractions({query: {session_id: sessionId}}, scope(projectId))
}

/** ATTACH — steal the attached lock and watch the live turn (force, no prompt). */
export async function attachStream(sessionId: string, projectId?: string | null) {
    return getSessionsClient().setSessionStream(
        {session_id: sessionId, force: true},
        scope(projectId),
    )
}

/** DETACH — drop this client's own attach without cancelling the run. */
export async function detachStream(
    sessionId: string,
    watcherId: string,
    projectId?: string | null,
) {
    return getSessionsClient().detachSessionStream(
        {session_id: sessionId, watcher_id: watcherId},
        scope(projectId),
    )
}

/** KILL — collapse the nest + tear the session down. */
export async function killStream(sessionId: string, projectId?: string | null) {
    return getSessionsClient().deleteSessionStream({session_id: sessionId}, scope(projectId))
}

export async function respondInteraction(
    interactionId: string,
    answer: Record<string, unknown>,
    projectId?: string | null,
) {
    return getSessionsClient().respondInteraction(
        {interaction_id: interactionId, answer},
        scope(projectId),
    )
}
