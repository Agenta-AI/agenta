/**
 * Sharing state: query atoms for the agent and session sharing state and the member picker,
 * and one mutation atom per write.
 *
 * Every key carries the current project id (`sharingKeys`). A write puts the state it returns
 * into its sharing key (the response is the new state, so no refetch is needed) and refreshes
 * the same project's session and workflow lists, because a visibility change adds or removes
 * rows there for other viewers and changes the row's own `visibility`.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import type {Query, QueryClient} from "@tanstack/react-query"
import {atom, type Getter} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {invalidateProjectSessionListQueries} from "../../session/state/invalidate"
import {
    fetchAgentSharing,
    fetchSessionSharing,
    fetchSharingMemberRoster,
    querySharingMembers,
    restrictSessionToOwner,
    revokeSessionGrant,
    setAgentVisibility,
    setSessionVisibility,
    takeAgentOwnership,
    transferAgent,
    upsertSessionGrant,
} from "../api"
import {sharingKeys} from "../core/keys"
import type {
    AgentSharingResponse,
    SessionRole,
    SessionSharingResponse,
    Visibility,
} from "../core/schema"

const SHARING_STALE_TIME = 30_000

/**
 * How often an open session re-reads its sharing state, and so the longest a revoked grant or
 * a lowered role stays on screen. The CONTRACT's live recheck bound: a live stream rechecks
 * access on the same cadence. No session event carries sharing changes to the client.
 */
export const SESSION_SHARING_RECHECK_MS = 60_000

type SessionSharingQuery = Query<
    SessionSharingResponse,
    Error,
    SessionSharingResponse,
    readonly unknown[]
>

/** When the session's sharing state was last read, answered or failed (0 = never). */
const lastSessionSharingRead = (query: Pick<SessionSharingQuery, "state">): number =>
    Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt)

/**
 * The open session's one recheck budget: a read, answered or failed, holds for
 * `SESSION_SHARING_RECHECK_MS`. Focus and remount re-read only once it has run out (the stale
 * time counts from the last read, a failed one included) and the poll runs once per budget.
 * A 4xx answer is not retried; another failure is retried once.
 */
const sessionSharingStaleTime = (query: SessionSharingQuery): number =>
    lastSessionSharingRead(query) + SESSION_SHARING_RECHECK_MS - query.state.dataUpdatedAt

const isClientError = (error: unknown): boolean => {
    const status = (error as {statusCode?: unknown} | null | undefined)?.statusCode
    return typeof status === "number" && status >= 400 && status < 500
}

// -- queries ---------------------------------------------------------------------------------

export const agentSharingQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: sharingKeys.agent(workflowId, projectId),
            queryFn: ({signal}: {signal?: AbortSignal}) =>
                fetchAgentSharing({projectId, workflowId, abortSignal: signal}),
            enabled: Boolean(projectId && workflowId),
            staleTime: SHARING_STALE_TIME,
            refetchOnWindowFocus: false,
        }
    }),
)

export const sessionSharingQueryAtomFamily = atomFamily((sessionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: sharingKeys.session(sessionId, projectId),
            queryFn: ({signal}: {signal?: AbortSignal}) =>
                fetchSessionSharing({projectId, sessionId, abortSignal: signal}),
            enabled: Boolean(projectId && sessionId),
            staleTime: sessionSharingStaleTime,
            // Only the open session subscribes, so only it polls. The poll restarts at every
            // read, so a focus or forced read does not add a second one inside the budget.
            refetchInterval: SESSION_SHARING_RECHECK_MS,
            refetchOnWindowFocus: true,
            retry: (failureCount: number, error: Error) =>
                !isClientError(error) && failureCount < 1,
        }
    }),
)

/**
 * Re-read the session's sharing state now, inside the same budget as the poll: nothing when a
 * read is running or the last one (answered or failed) is younger than
 * `SESSION_SHARING_RECHECK_MS`. For a signal that access may have changed (the watch stream
 * closing) that must not turn into a request storm.
 */
export const recheckSessionSharing = async ({
    queryClient,
    sessionId,
    projectId,
}: {
    queryClient: QueryClient
    sessionId: string
    projectId: string
}): Promise<void> => {
    const query = queryClient.getQueryCache().find<SessionSharingResponse>({
        queryKey: sharingKeys.session(sessionId, projectId),
        exact: true,
    })
    if (!query || query.getObserversCount() === 0) return
    if (query.state.fetchStatus === "fetching") return
    if (Date.now() - lastSessionSharingRead(query) < SESSION_SHARING_RECHECK_MS) return
    await queryClient.refetchQueries({
        queryKey: sharingKeys.session(sessionId, projectId),
        exact: true,
        type: "active",
    })
}

/** The first page of the member picker for one search text. */
export const sharingMembersQueryAtomFamily = atomFamily((search: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom) ?? ""
        const normalized = search.trim()
        return {
            queryKey: sharingKeys.members(projectId, normalized),
            queryFn: ({signal}: {signal?: AbortSignal}) =>
                querySharingMembers({
                    projectId,
                    search: normalized || undefined,
                    abortSignal: signal,
                }),
            enabled: Boolean(projectId),
            staleTime: SHARING_STALE_TIME,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * Every member of the project, for surfaces that name people by id (the agent list's Owner
 * column): an id missing from it is a former member. Not the picker's first page, which holds
 * only 50 people.
 */
export const sharingMemberRosterQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom) ?? ""
    return {
        queryKey: sharingKeys.roster(projectId),
        queryFn: ({signal}: {signal?: AbortSignal}) =>
            fetchSharingMemberRoster({projectId, abortSignal: signal}),
        enabled: Boolean(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    }
})

// -- mutations -------------------------------------------------------------------------------

function requireProjectId(get: Getter): string {
    const projectId = get(projectIdAtom)
    if (!projectId) throw new Error("No project ID available")
    return projectId
}

/** The query client is resolved on each call: the host may install it after this module loads. */
function invalidateProjectLists(projectId: string): void {
    invalidateProjectSessionListQueries(projectId)
    void getHostQueryClient().invalidateQueries({
        queryKey: ["workflows", "apps", "list", projectId],
    })
}

function storeAgentSharing(
    projectId: string,
    workflowId: string,
    response: AgentSharingResponse,
): AgentSharingResponse {
    getHostQueryClient().setQueryData(sharingKeys.agent(workflowId, projectId), response)
    invalidateProjectLists(projectId)
    return response
}

function storeSessionSharing(
    projectId: string,
    sessionId: string,
    response: SessionSharingResponse,
): SessionSharingResponse {
    getHostQueryClient().setQueryData(sharingKeys.session(sessionId, projectId), response)
    invalidateProjectLists(projectId)
    return response
}

export const setAgentVisibilityAtom = atom(
    null,
    async (get, _set, {workflowId, visibility}: {workflowId: string; visibility: Visibility}) => {
        const projectId = requireProjectId(get)
        const response = await setAgentVisibility({projectId, workflowId, visibility})
        return storeAgentSharing(projectId, workflowId, response)
    },
)

export const transferAgentAtom = atom(
    null,
    async (get, _set, {workflowId, userId}: {workflowId: string; userId: string}) => {
        const projectId = requireProjectId(get)
        const response = await transferAgent({projectId, workflowId, userId})
        return storeAgentSharing(projectId, workflowId, response)
    },
)

export const takeAgentOwnershipAtom = atom(
    null,
    async (get, _set, {workflowId}: {workflowId: string}) => {
        const projectId = requireProjectId(get)
        const response = await takeAgentOwnership({projectId, workflowId})
        return storeAgentSharing(projectId, workflowId, response)
    },
)

export const upsertSessionGrantAtom = atom(
    null,
    async (
        get,
        _set,
        {sessionId, userId, role}: {sessionId: string; userId: string; role: SessionRole},
    ) => {
        const projectId = requireProjectId(get)
        const response = await upsertSessionGrant({projectId, sessionId, userId, role})
        return storeSessionSharing(projectId, sessionId, response)
    },
)

export const revokeSessionGrantAtom = atom(
    null,
    async (get, _set, {sessionId, userId}: {sessionId: string; userId: string}) => {
        const projectId = requireProjectId(get)
        const response = await revokeSessionGrant({projectId, sessionId, userId})
        return storeSessionSharing(projectId, sessionId, response)
    },
)

export const setSessionVisibilityAtom = atom(
    null,
    async (get, _set, {sessionId, visibility}: {sessionId: string; visibility: Visibility}) => {
        const projectId = requireProjectId(get)
        const response = await setSessionVisibility({projectId, sessionId, visibility})
        return storeSessionSharing(projectId, sessionId, response)
    },
)

export const restrictSessionToOwnerAtom = atom(
    null,
    async (get, _set, {sessionId}: {sessionId: string}) => {
        const projectId = requireProjectId(get)
        const response = await restrictSessionToOwner({projectId, sessionId})
        return storeSessionSharing(projectId, sessionId, response)
    },
)
