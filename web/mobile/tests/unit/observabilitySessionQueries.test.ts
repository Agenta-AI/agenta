/**
 * The session drawer's data layer with its real atoms. The requests are faked where they leave
 * the app: the Fern traces client for the session traces, axios for the annotations.
 */
import {bindWorkspaceMembersAtom, type WorkspaceMember} from "@agenta/entities/organization"
import {
    bindObservabilityScopeAtom,
    type ObservabilityScope,
    observabilityScopeAtom,
} from "@agenta/observability"
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {atom, createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    observabilitySessionAnnotatedTracesAtomFamily,
    observabilitySessionAnnotationsQueryAtomFamily,
    observabilitySessionStatsAtomFamily,
    observabilitySessionTracesAtomFamily,
    observabilitySessionTracesQueryAtomFamily,
    SESSION_TRACES_PAGE_SIZE,
} from "@/features/observability/sessionDrawer/sessionDrawerQueries"

const {queryTraces} = vi.hoisted(() => ({queryTraces: vi.fn()}))

vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getTracesClient: () => ({queryTraces}),
}))

const span = (overrides: Record<string, unknown>) => ({
    span_name: "step",
    start_time: "2026-01-01T09:00:00Z",
    ...overrides,
})

/** One trace with a child span, and an annotation trace that must not reach the drawer. */
const TRACES = [
    {
        trace_id: "11111111-1111-1111-1111-111111111111",
        spans: {
            chat: span({
                trace_id: "11111111-1111-1111-1111-111111111111",
                span_id: "aaaaaaaaaaaaaaaa",
                trace_type: "invocation",
                attributes: {ag: {metrics: {tokens: {cumulative: {total: 7}}}}},
                spans: {
                    llm: span({
                        trace_id: "11111111-1111-1111-1111-111111111111",
                        span_id: "bbbbbbbbbbbbbbbb",
                        parent_id: "aaaaaaaaaaaaaaaa",
                    }),
                },
            }),
        },
    },
    {
        trace_id: "22222222-2222-2222-2222-222222222222",
        spans: {
            note: span({
                trace_id: "22222222-2222-2222-2222-222222222222",
                span_id: "cccccccccccccccc",
                trace_type: "annotation",
            }),
        },
    },
]

describe("session drawer queries", () => {
    let store: ReturnType<typeof createStore>

    const settle = async (sessionId: string) => {
        const unsubscribe = store.sub(observabilitySessionTracesQueryAtomFamily(sessionId), vi.fn())
        await vi.waitFor(() => {
            const state = store.get(observabilitySessionTracesQueryAtomFamily(sessionId))
            expect(state.isPending).toBe(false)
        })
        return unsubscribe
    }

    beforeEach(() => {
        queryTraces.mockReset().mockResolvedValue({count: TRACES.length, traces: TRACES})
        store = createStore()
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(projectIdAtom, "project-1")
    })
    afterEach(() => vi.restoreAllMocks())

    it("The traces request filters on ag.session.id with focus trace and the app scope", async () => {
        const scope = atom<ObservabilityScope>({appId: "app-1", routeAppId: "app-1"})
        store.set(bindObservabilityScopeAtom, scope)
        expect(store.get(observabilityScopeAtom).appId).toBe("app-1")

        const unsubscribe = await settle("session-a")

        expect(queryTraces).toHaveBeenCalledTimes(1)
        const [body, options] = queryTraces.mock.calls[0]
        expect(body).toEqual({
            filtering: {
                conditions: [
                    {field: "attributes", key: "ag.session.id", operator: "is", value: "session-a"},
                ],
            },
            windowing: {limit: SESSION_TRACES_PAGE_SIZE},
        })
        expect(options.queryParams).toEqual({project_id: "project-1", application_id: "app-1"})
        unsubscribe()
    })

    it("Annotation nodes are dropped from the session tree", async () => {
        const unsubscribe = await settle("session-a")
        const {traces, truncated} = store.get(observabilitySessionTracesAtomFamily("session-a"))
        expect(traces.map((trace) => trace.span_id)).toEqual(["aaaaaaaaaaaaaaaa"])
        expect(truncated).toBe(false)
        unsubscribe()
    })

    it("Annotations are requested for every span of the session", async () => {
        const post = vi.spyOn(axios, "post").mockResolvedValue({data: {count: 0, traces: []}})
        const unsubscribe = await settle("session-a")
        const unsubscribeAnnotations = store.sub(
            observabilitySessionAnnotationsQueryAtomFamily("session-a"),
            vi.fn(),
        )
        await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
        const [url, body, config] = post.mock.calls[0]
        expect(url).toContain("/simple/traces/query")
        expect(body).toEqual({
            trace: {
                links: [
                    {trace_id: "11111111-1111-1111-1111-111111111111", span_id: "aaaaaaaaaaaaaaaa"},
                    {trace_id: "11111111-1111-1111-1111-111111111111", span_id: "bbbbbbbbbbbbbbbb"},
                ],
            },
        })
        expect(config).toEqual({params: {project_id: "project-1"}})
        unsubscribe()
        unsubscribeAnnotations()
    })

    it("Annotations are requested again when the spans change but their number does not", async () => {
        const post = vi.spyOn(axios, "post").mockResolvedValue({data: {count: 0, traces: []}})
        const unsubscribe = await settle("session-d")
        const unsubscribeAnnotations = store.sub(
            observabilitySessionAnnotationsQueryAtomFamily("session-d"),
            vi.fn(),
        )
        await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))

        const swapped = JSON.parse(
            JSON.stringify(TRACES.slice(0, 1)).replace(/aaaaaaaaaaaaaaaa/g, "eeeeeeeeeeeeeeee"),
        )
        queryTraces.mockResolvedValue({count: 1, traces: swapped})
        await store
            .get(queryClientAtom)
            .invalidateQueries({queryKey: ["observability-session-traces"]})

        await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
        expect(post.mock.calls[1][1]).toEqual({
            trace: {
                links: [
                    {trace_id: "11111111-1111-1111-1111-111111111111", span_id: "eeeeeeeeeeeeeeee"},
                    {trace_id: "11111111-1111-1111-1111-111111111111", span_id: "bbbbbbbbbbbbbbbb"},
                ],
            },
        })
        unsubscribe()
        unsubscribeAnnotations()
    })

    it("Annotation author names resolve once members load, without a new request", async () => {
        const post = vi.spyOn(axios, "post").mockResolvedValue({
            data: {
                count: 1,
                traces: [
                    {
                        trace_id: "ffffffffffffffffffffffffffffffff",
                        span_id: "dddddddddddddddd",
                        created_by_id: "user-1",
                        links: {
                            invocation: {
                                trace_id: "11111111-1111-1111-1111-111111111111",
                                span_id: "aaaaaaaaaaaaaaaa",
                            },
                        },
                    },
                ],
            },
        })
        const members = atom<WorkspaceMember[]>([])
        store.set(bindWorkspaceMembersAtom, members)
        const unsubscribe = await settle("session-e")
        const unsubscribeAnnotated = store.sub(
            observabilitySessionAnnotatedTracesAtomFamily("session-e"),
            vi.fn(),
        )
        const authorOf = () =>
            (
                store.get(observabilitySessionAnnotatedTracesAtomFamily("session-e"))[0]
                    .annotations?.[0] as {createdBy?: string} | undefined
            )?.createdBy
        await vi.waitFor(() => expect(authorOf()).toBe("user-1"))

        store.set(members, [{user: {id: "user-1", username: "Alex"}} as WorkspaceMember])

        await vi.waitFor(() => expect(authorOf()).toBe("Alex"))
        expect(post).toHaveBeenCalledTimes(1)
        unsubscribe()
        unsubscribeAnnotated()
    })

    it("A failed traces request is an error, not an empty session", async () => {
        queryTraces.mockRejectedValue(new Error("boom"))
        const unsubscribe = store.sub(
            observabilitySessionTracesQueryAtomFamily("session-b"),
            vi.fn(),
        )
        await vi.waitFor(() =>
            expect(store.get(observabilitySessionTracesQueryAtomFamily("session-b")).isError).toBe(
                true,
            ),
        )
        unsubscribe()
    })

    it("A full page marks the session as cut short", async () => {
        queryTraces.mockResolvedValue({
            count: SESSION_TRACES_PAGE_SIZE,
            traces: Array.from({length: SESSION_TRACES_PAGE_SIZE}, (_, index) => ({
                trace_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
                spans: {
                    chat: span({
                        trace_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
                        span_id: `span-${index}`,
                    }),
                },
            })),
        })
        const unsubscribe = await settle("session-c")
        const result = store.get(observabilitySessionTracesAtomFamily("session-c"))
        expect(result.traces).toHaveLength(SESSION_TRACES_PAGE_SIZE)
        expect(result.truncated).toBe(true)
        unsubscribe()
    })

    it("Stats come from the loaded traces", async () => {
        const unsubscribe = await settle("session-a")
        expect(store.get(observabilitySessionStatsAtomFamily("session-a"))?.tokens).toBe(7)
        unsubscribe()
    })

    it("Annotations attach to their trace with the author name once members load", async () => {
        vi.spyOn(axios, "post").mockResolvedValue({
            data: {
                count: 1,
                traces: [
                    {
                        trace_id: "ffffffffffffffffffffffffffffffff",
                        span_id: "dddddddddddddddd",
                        created_by_id: "user-1",
                        created_at: "2026-01-01T09:00:00Z",
                        links: {
                            invocation: {
                                trace_id: "11111111-1111-1111-1111-111111111111",
                                span_id: "aaaaaaaaaaaaaaaa",
                            },
                        },
                        data: {outputs: {score: 1}},
                    },
                ],
            },
        })
        const unsubscribe = await settle("session-a")
        const unsubscribeAnnotated = store.sub(
            observabilitySessionAnnotatedTracesAtomFamily("session-a"),
            vi.fn(),
        )
        await vi.waitFor(() => {
            const [trace] = store.get(observabilitySessionAnnotatedTracesAtomFamily("session-a"))
            expect(trace.annotations).toHaveLength(1)
        })
        unsubscribe()
        unsubscribeAnnotated()
    })
})
