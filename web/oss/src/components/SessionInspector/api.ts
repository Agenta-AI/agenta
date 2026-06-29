import {getAgentaSdkClient} from "@agenta/sdk"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

const client = () => getAgentaSdkClient({host: getAgentaApiUrl()})

const scope = (projectId?: string | null) =>
    projectId ? {queryParams: {project_id: projectId}} : undefined

export async function fetchStream(sessionId: string, projectId?: string | null) {
    const res = await client().sessions.fetchSessionStream(
        {session_id: sessionId},
        scope(projectId),
    )
    return res.stream ?? null
}

export async function fetchTranscripts(sessionId: string, projectId?: string | null) {
    return client().sessions.queryTranscripts({session_id: sessionId}, scope(projectId))
}

export async function fetchState(sessionId: string, projectId?: string | null) {
    const res = await client().sessions.getState({session_id: sessionId}, scope(projectId))
    return res.session_state ?? null
}

export async function fetchMounts(sessionId: string, projectId?: string | null) {
    return client().sessions.querySessionMounts({session_id: sessionId}, scope(projectId))
}

export async function fetchInteractions(sessionId: string, projectId?: string | null) {
    return client().sessions.queryInteractions({query: {session_id: sessionId}}, scope(projectId))
}

/** ATTACH — steal the attached lock and watch the live turn (force, no prompt). */
export async function attachStream(sessionId: string, projectId?: string | null) {
    return client().sessions.setSessionStream(
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
    return client().sessions.detachSessionStream(
        {session_id: sessionId, watcher_id: watcherId},
        scope(projectId),
    )
}

/** KILL — collapse the nest + tear the session down. */
export async function killStream(sessionId: string, projectId?: string | null) {
    return client().sessions.deleteSessionStream({session_id: sessionId}, scope(projectId))
}

export async function respondInteraction(
    interactionId: string,
    answer: Record<string, unknown>,
    projectId?: string | null,
) {
    return client().sessions.respondInteraction(
        {interaction_id: interactionId, answer},
        scope(projectId),
    )
}
