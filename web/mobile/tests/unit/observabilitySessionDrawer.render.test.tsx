// @vitest-environment jsdom
/**
 * The session drawer with its real atoms, tree and panels. The requests are faked where they
 * leave the app (the Fern traces client and axios). Only the session list, the width query and
 * the annotation chips are stubbed.
 */
import {act} from "react"

import {traceDrawerAtom} from "@agenta/observability/traceDrawer"
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
} as unknown as typeof ResizeObserver

const {queryTraces, sessions, wide, router, members, developerMode, panels} = vi.hoisted(() => ({
    developerMode: {current: false},
    panels: [] as {title: unknown; messages: unknown; preset: unknown}[],
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/observability",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    members: {current: [] as {user: {id: string; username: string}}[]},
    queryTraces: vi.fn(),
    sessions: {ids: ["session-a", "session-b", "session-c"]},
    wide: {current: true},
}))

vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        betaDeveloperModeActiveAtom: atom(() => developerMode.current),
    }
})
// The turn actions are the trace drawer's; their own gates are covered by their tests.
vi.mock("@/features/observability/addToTestset/AddToTestsetDrawerButton", () => ({
    AddToTestsetDrawerButton: ({spanIds}: {spanIds: string[]}) => (
        <button type="button">{`Add to testset ${spanIds.join(",")}`}</button>
    ),
}))
vi.mock("@/features/observability/annotate/TraceAnnotateButton", () => ({
    TraceAnnotateButton: ({traceSpanIds}: {traceSpanIds: {spanId: string}}) => (
        <button type="button">{`Annotate ${traceSpanIds.spanId}`}</button>
    ),
}))
// The members come the way Settings gets them: the workspace's projects, then its organization.
vi.mock("@agenta/entities/project", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/project")>()),
    fetchAllProjects: async () => [{organization_id: "org-1", workspace_id: "ws"}],
}))
vi.mock("@agenta/entities/organization", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/organization")>()),
    fetchSingleOrg: async () => ({default_workspace: {members: members.current}}),
}))
vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getTracesClient: () => ({queryTraces}),
}))
vi.mock("@agenta/observability", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/observability")>()),
    useSessions: () => ({sessionIds: sessions.ids}),
}))
vi.mock("@agenta/ui/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/hooks")>()),
    useMediaQuery: () => wide.current,
}))
vi.mock("@agenta/observability-ui/traceDrawer", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/observability-ui/traceDrawer")>()),
    // The message panel is the drawer's drill-in slot; this records what each turn hands it.
    getTraceDrawerReferences: () => ({
        TraceSpanDrillInView: (props: Record<string, unknown>) => {
            panels.push({
                title: props.title,
                messages: props.spanDataOverride,
                preset: props.viewModePreset,
            })
            return <div data-testid="message-panel" />
        },
    }),
    TraceAnnotations: ({annotations}: {annotations: unknown[]}) => (
        <div data-testid="annotations">{annotations.length} annotations</div>
    ),
}))

import ObservabilitySessionDrawer from "@/features/observability/sessionDrawer/ObservabilitySessionDrawer"
import {observabilitySessionAnnotatedTracesAtomFamily} from "@/features/observability/sessionDrawer/sessionDrawerQueries"

const TRACE_1 = "11111111-1111-1111-1111-111111111111"
const TRACE_2 = "22222222-2222-2222-2222-222222222222"

// The session atoms are cached per session id for the life of the module, so a test that changes
// the response uses an id of its own.
const span = (overrides: Record<string, unknown>) => ({span_name: "chat", ...overrides})

const SESSION_TRACES = [
    // Listed newest first, as the API does: the drawer must show them oldest first.
    {
        trace_id: TRACE_2,
        spans: {
            chat: span({
                trace_id: TRACE_2,
                span_id: "span-two-root",
                start_time: "2026-01-01T10:00:00Z",
                status_code: "STATUS_CODE_ERROR",
                status_message: "Provider timed out",
                attributes: {
                    ag: {
                        data: {
                            inputs: {
                                messages: [
                                    {role: "user", content: "Hi Alex"},
                                    {role: "assistant", content: "Hello Sam"},
                                    {role: "user", content: "Plan lunch"},
                                ],
                            },
                        },
                        metrics: {tokens: {cumulative: {total: 5}}},
                    },
                },
                spans: {
                    llm: span({
                        trace_id: TRACE_2,
                        span_id: "span-two-child",
                        parent_id: "span-two-root",
                        span_name: "llm call",
                        start_time: "2026-01-01T10:00:01Z",
                    }),
                },
            }),
        },
    },
    {
        trace_id: TRACE_1,
        spans: {
            chat: span({
                trace_id: TRACE_1,
                span_id: "span-one-root",
                start_time: "2026-01-01T09:00:00Z",
                attributes: {
                    ag: {
                        data: {
                            inputs: {messages: [{role: "user", content: "Hi Alex"}]},
                            outputs: {role: "assistant", content: "Hello Sam"},
                            parameters: {prompt: {llm_config: {model: "model-one"}}},
                        },
                        metrics: {tokens: {cumulative: {total: 3}}},
                    },
                },
            }),
        },
    },
]

/** Retries an assertion, flushing React between tries so updates land inside `act`. */
const until = async (assertion: () => void) => {
    const deadline = Date.now() + 2000
    for (;;) {
        try {
            return assertion()
        } catch (error) {
            if (Date.now() > deadline) throw error
            await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
        }
    }
}

describe("ObservabilitySessionDrawer", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    let client: QueryClient
    const onSelectSession = vi.fn()
    const scrollIntoView = vi.fn()

    const text = () => document.body.textContent ?? ""
    const button = (label: string) =>
        [...document.querySelectorAll("button")].find(
            (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
        )
    const click = async (label: string) => {
        await until(() => expect(button(label), `button "${label}"`).toBeDefined())
        await act(async () => button(label)?.click())
    }
    const shown = (sessionId: string | null = "session-b", spanId: string | null = null) => {
        router.query = spanId ? {workspace_id: "ws", span: spanId} : {workspace_id: "ws"}
        return act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Provider store={store}>
                        <ObservabilitySessionDrawer
                            sessionId={sessionId}
                            onSelectSession={onSelectSession}
                        />
                    </Provider>
                </QueryClientProvider>,
            )
        })
    }
    const loaded = () => vi.waitFor(() => expect(text()).toContain("Trace 1"))

    beforeEach(() => {
        localStorage.clear()
        wide.current = true
        developerMode.current = false
        panels.length = 0
        sessions.ids = ["session-a", "session-b", "session-c"]
        queryTraces.mockReset().mockResolvedValue({count: 2, traces: SESSION_TRACES})
        onSelectSession.mockReset()
        router.replace.mockReset()
        scrollIntoView.mockReset()
        Element.prototype.scrollIntoView = scrollIntoView
        vi.spyOn(axios, "post").mockResolvedValue({data: {count: 0, traces: []}})
        store = createStore()
        client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        store.set(queryClientAtom, client)
        members.current = []
        store.set(projectIdAtom, "project-1")
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.restoreAllMocks()
    })

    it("Next opens the following session in the list", async () => {
        await shown("session-b")
        await click("Next session")
        expect(onSelectSession).toHaveBeenCalledWith("session-c")
        await click("Previous session")
        expect(onSelectSession).toHaveBeenLastCalledWith("session-a")
    })

    it("Prev is disabled on the first session and Next on the last", async () => {
        await shown("session-a")
        expect(button("Previous session")?.disabled).toBe(true)
        expect(button("Next session")?.disabled).toBe(false)
        await shown("session-c")
        expect(button("Next session")?.disabled).toBe(true)
        await shown("session-not-in-list")
        expect(button("Previous session")?.disabled).toBe(true)
        expect(button("Next session")?.disabled).toBe(true)
    })

    it("Shows the session id and closes from the X button", async () => {
        await shown("session-b")
        expect(text()).toContain("# session-b")
        await click("Close")
        expect(router.replace).toHaveBeenCalledTimes(1)
    })

    it("Closing gives focus back to the row that opened the drawer", async () => {
        const row = document.createElement("div")
        row.tabIndex = 0
        document.body.append(row)
        row.focus()
        await shown("session-b")
        await loaded()
        expect(document.activeElement).not.toBe(row)
        await shown(null)
        await vi.waitFor(() => expect(document.activeElement).toBe(row))
        row.remove()
    })

    it("Traces render oldest first as Trace 1 and Trace 2", async () => {
        await shown()
        await loaded()
        const panels = [...document.querySelectorAll("[data-slot='accordion-trigger']")].map(
            (el) => el.textContent,
        )
        expect(panels).toEqual(["Trace 1", "Trace 2"])
        expect(document.querySelectorAll("#session-trace-span-one-root")).toHaveLength(1)
        expect(text()).toContain("Models")
        expect(text()).toContain("model-one")
    })

    it("An error trace shows its message, and later traces hide the earlier ones", async () => {
        await shown()
        await loaded()
        expect(text()).toContain("Provider timed out")
        expect(text()).toContain("Plan lunch")
        // Trace 2 repeats "Hello Sam" in its first two messages, which are hidden.
        expect(text().match(/Hello Sam/g)).toHaveLength(1)
        await click("Show all messages")
        expect(text().match(/Hello Sam/g)).toHaveLength(2)
        expect(button("Hide first messages")).toBeDefined()
    })

    it("The toggle reads Hide annotations and hides the annotation column", async () => {
        await shown()
        await loaded()
        expect(document.querySelectorAll("[data-testid='annotations']")).toHaveLength(2)
        await click("Hide annotations")
        expect(button("Show annotations")).toBeDefined()
        expect(document.querySelectorAll("[data-testid='annotations']")).toHaveLength(0)
        expect(localStorage.getItem("chat-session-annotation-ui")).toBe("false")
    })

    it("A failed load shows Could not load this session with a retry", async () => {
        queryTraces.mockRejectedValue(new Error("down"))
        await shown()
        await until(() => expect(text()).toContain("Could not load this session"))
        queryTraces.mockResolvedValue({count: 2, traces: SESSION_TRACES})
        await click("Try again")
        await loaded()
    })

    it("An unknown session id shows No traces in this session", async () => {
        queryTraces.mockResolvedValue({count: 0, traces: []})
        await shown("session-empty")
        await until(() => expect(text()).toContain("No traces in this session"))
    })

    it("A span in the link selects and scrolls to its trace", async () => {
        await shown("session-b", "span-one-root")
        await loaded()
        await until(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
        expect(scrollIntoView.mock.contexts[0]).toBe(
            document.getElementById("session-trace-span-one-root"),
        )
        expect(store.get(traceDrawerAtom).open).toBe(false)
    })

    it("A link to a span inside a trace opens the trace drawer on it, once", async () => {
        await shown("session-b", "span-two-child")
        await loaded()
        await until(() => expect(store.get(traceDrawerAtom).open).toBe(true))
        expect(store.get(traceDrawerAtom).traceId).toBe(TRACE_2)
        expect(store.get(traceDrawerAtom).activeSpanId).toBe("span-two-child")
        act(() => store.set(traceDrawerAtom, (draft) => void (draft.open = false)))
        await shown("session-b", "span-two-child")
        expect(store.get(traceDrawerAtom).open).toBe(false)
    })

    it("Selecting a trace in the tree scrolls to its panel", async () => {
        await shown()
        await loaded()
        const node = [...document.querySelectorAll("[data-testid='session-tree'] *")].find(
            (el) => el.children.length === 0 && el.textContent === "Trace 2",
        )
        expect(node).toBeDefined()
        await act(async () => (node as HTMLElement).click())
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(
            document.getElementById("session-trace-span-two-root"),
        )
    })

    it("Search in session filters the tree", async () => {
        await shown()
        await loaded()
        const tree = () => document.querySelector("[data-testid='session-tree']")?.textContent ?? ""
        expect(tree()).toContain("Trace 1")
        const input = document.querySelector<HTMLInputElement>(
            "input[placeholder='Search in session']",
        )
        expect(input).not.toBeNull()
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        await act(async () => {
            setValue?.call(input, "Trace 2")
            input?.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(tree()).toContain("Trace 2")
        expect(tree()).not.toContain("Trace 1")
    })

    it("View trace opens the trace drawer on the trace root", async () => {
        await shown()
        await loaded()
        await act(async () =>
            [...document.querySelectorAll("button")]
                .filter((b) => b.textContent?.trim() === "View trace")[0]
                ?.click(),
        )
        expect(store.get(traceDrawerAtom)).toMatchObject({
            open: true,
            traceId: TRACE_1,
            activeSpanId: "span-one-root",
        })
    })

    it("A phone-width drawer shows the traces without the tree or the width toggle", async () => {
        wide.current = false
        await shown()
        await loaded()
        expect(document.querySelector("[data-testid='session-tree']")).toBeNull()
        expect(button("Make the drawer wider")).toBeUndefined()
    })

    it("Annotation authors show their name, with no member list bound by the test", async () => {
        members.current = [{user: {id: "user-1", username: "Alex"}}]
        vi.spyOn(axios, "post").mockResolvedValue({
            data: {
                count: 1,
                traces: [
                    {
                        trace_id: "ffffffffffffffffffffffffffffffff",
                        span_id: "dddddddddddddddd",
                        created_by_id: "user-1",
                        links: {invocation: {trace_id: TRACE_1, span_id: "span-one-root"}},
                    },
                ],
            },
        })
        await shown("session-members")
        await until(() => {
            const annotated = store
                .get(observabilitySessionAnnotatedTracesAtomFamily("session-members"))
                .find((trace) => trace.span_id === "span-one-root")
            expect(annotated?.annotations?.[0]).toMatchObject({createdBy: "Alex"})
        })
    })

    it("In developer mode each turn has its own actions, its status and the message panel", async () => {
        developerMode.current = true
        await shown()
        await loaded()
        expect(button("Add to testset span-one-root")).toBeDefined()
        expect(button("Annotate span-one-root")).toBeDefined()
        expect(button("Annotate span-two-root")).toBeDefined()
        expect(text()).toContain("success")
        expect(text()).toContain("failure")
        expect(document.querySelectorAll("[data-testid='message-panel']")).toHaveLength(2)
        const last = panels.at(-1)
        expect(last?.title).toBe("messages")
        expect(last?.preset).toBe("message")
        expect(Array.isArray(last?.messages)).toBe(true)
    })

    it("Outside developer mode a turn keeps its plain messages and no actions", async () => {
        await shown()
        await loaded()
        expect(button("Annotate span-one-root")).toBeUndefined()
        expect(document.querySelectorAll("[data-testid='message-panel']")).toHaveLength(0)
    })

    it("Hides the models pill when no trace names a model", async () => {
        queryTraces.mockResolvedValue({count: 1, traces: [SESSION_TRACES[0]]})
        await shown("session-unnamed-model")
        await until(() => expect(text()).toContain("Summary"))
        expect(text()).not.toContain("Models")
    })
})
