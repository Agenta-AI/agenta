import {
    attachAnnotationsToTraces,
    queryAllAnnotations,
    transformApiData,
    type AnnotationDto,
} from "@agenta/entities/annotation/dto"
import {workspaceMembersAtom} from "@agenta/entities/organization"
import {
    fetchAllPreviewTraces,
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@agenta/entities/trace"
import {observabilityScopeAtom, type TraceSpanNode} from "@agenta/observability"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {buildSessionStats, type SessionStats} from "./sessionTurns"

/**
 * The most traces one request returns. It is also what the request asks for, so a response of
 * this size means the session may hold more than the drawer shows.
 */
export const SESSION_TRACES_PAGE_SIZE = 100

export interface SessionTraces {
    traces: TraceSpanNode[]
    /** The response filled the page, so the session may have more traces than it holds. */
    truncated: boolean
}

const flatten = (nodes: TraceSpanNode[]): TraceSpanNode[] =>
    nodes.flatMap((node) => [node, ...flatten((node.children ?? []) as TraceSpanNode[])])

/**
 * Every trace of one observability session, as trees.
 *
 * The request uses the scope of the sessions list, so the app filter on the page applies here
 * too. The API answers a failed request with nothing at all, so that case throws: the drawer
 * must show an error and not an empty session.
 */
export const observabilitySessionTracesQueryAtomFamily = atomFamily((sessionId: string) =>
    atomWithQuery<SessionTraces>((get) => {
        const projectId = get(projectIdAtom)
        const appId = get(observabilityScopeAtom).appId
        return {
            queryKey: ["observability-session-traces", projectId, appId, sessionId],
            enabled: Boolean(projectId) && Boolean(sessionId),
            refetchOnWindowFocus: false,
            queryFn: async () => {
                const response = await fetchAllPreviewTraces(
                    {
                        filter: {
                            conditions: [
                                {
                                    field: "attributes",
                                    key: "ag.session.id",
                                    operator: "is",
                                    value: sessionId,
                                },
                            ],
                        },
                        focus: "trace",
                        size: SESSION_TRACES_PAGE_SIZE,
                    },
                    appId ?? "",
                    projectId ?? "",
                )
                if (!response) throw new Error("The session traces request failed.")
                let nodes: TraceSpanNode[] = []
                let count = 0
                if (isTracesResponse(response)) {
                    nodes = transformTracingResponse(transformTracesResponseToTree(response))
                    count = response.count
                } else if (isSpansResponse(response)) {
                    nodes = transformTracingResponse(response.spans)
                    count = response.count
                }
                return {
                    traces: nodes.filter((node) => node.trace_type !== "annotation"),
                    truncated: count >= SESSION_TRACES_PAGE_SIZE,
                }
            },
        }
    }),
)

export const observabilitySessionTracesAtomFamily = atomFamily((sessionId: string) =>
    atom((get): SessionTraces => {
        const data = get(observabilitySessionTracesQueryAtomFamily(sessionId)).data
        return data ?? {traces: [], truncated: false}
    }),
)

/** The trace and span id of every span in the session, which the annotations request needs. */
const sessionAnnotationLinksAtomFamily = atomFamily((sessionId: string) =>
    atom((get) =>
        flatten(get(observabilitySessionTracesAtomFamily(sessionId)).traces).map((node) => ({
            trace_id: node.trace_id,
            span_id: node.span_id,
        })),
    ),
)

/**
 * The raw annotations of the session. The key holds the number of links and not the links: a
 * long session would put every span id in the key. The `session-drawer-annotations` prefix is
 * the one a saved annotation invalidates.
 */
export const observabilitySessionAnnotationsQueryAtomFamily = atomFamily((sessionId: string) =>
    atomWithQuery<AnnotationDto[]>((get) => {
        const projectId = get(projectIdAtom)
        const links = get(sessionAnnotationLinksAtomFamily(sessionId))
        return {
            queryKey: ["session-drawer-annotations", projectId, sessionId, links.length],
            enabled: links.length > 0,
            refetchOnWindowFocus: false,
            queryFn: async () => {
                const response = await queryAllAnnotations({
                    projectId: projectId ?? undefined,
                    queries: {annotation: {links}},
                })
                return response.annotations ?? []
            },
        }
    }),
)

/**
 * The session traces with their annotations attached. The author names come from the members
 * read here, not when the request ran, so names appear once the members load.
 */
export const observabilitySessionAnnotatedTracesAtomFamily = atomFamily((sessionId: string) =>
    atom((get): TraceSpanNode[] => {
        const {traces} = get(observabilitySessionTracesAtomFamily(sessionId))
        const raw = get(observabilitySessionAnnotationsQueryAtomFamily(sessionId)).data
        if (!traces.length || !raw?.length) return traces
        const members = get(workspaceMembersAtom)
        const annotations = raw.map((annotation) =>
            transformApiData<AnnotationDto>({data: annotation, members}),
        )
        return attachAnnotationsToTraces(traces, annotations)
    }),
)

export const observabilitySessionStatsAtomFamily = atomFamily((sessionId: string) =>
    atom((get): SessionStats | null =>
        buildSessionStats(get(observabilitySessionTracesAtomFamily(sessionId)).traces),
    ),
)
