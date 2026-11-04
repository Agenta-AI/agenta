// @vitest-environment jsdom
/**
 * "Add to test set" in the playground's test set menu, over the real playground run, the real
 * trace stores and the real add-to-test-set sheet. Only HTTP is mocked (axios, the workflow
 * service and the generated API clients), and the sheet's searchable selects render as native
 * selects (the popover needs pointer events jsdom does not send).
 */
import {act, type ReactNode} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundRunPane} from "@/features/playground/PlaygroundRunPane"
import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {
    button,
    completionRevision,
    settle,
    stubResizeObserver,
    typeInto,
} from "../support/playgroundHarness"

const {http, router, api} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    api: {
        querySpans: vi.fn(),
        queryTestsets: vi.fn(),
        checkPermissions: vi.fn(),
    },
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        asPath: "/",
        replace: vi.fn(),
        push: vi.fn(),
        events: {on: vi.fn(), off: vi.fn()},
    },
}))
vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<typeof import("@agenta/sdk/resources")>()),
    getTracesClient: () => ({querySpans: api.querySpans}),
    getLowPriorityTracesClient: () => ({querySpans: api.querySpans}),
    getTestsetsClient: () => ({queryTestsets: api.queryTestsets}),
    getAccessClient: () => ({checkPermissions: api.checkPermissions}),
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
vi.mock("@agenta/ui/ui", async (original) => {
    const actual = await original<typeof import("@agenta/ui/ui")>()
    return {
        ...actual,
        Combobox: ({
            options,
            value,
            onChange,
            "aria-label": label,
        }: {
            options: {value: string; label: ReactNode}[]
            value?: string
            onChange?: (value: string | undefined) => void
            "aria-label"?: string
        }) => (
            <select
                aria-label={label}
                value={value ?? ""}
                onChange={(event) => onChange?.(event.target.value || undefined)}
            >
                <option value="" />
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        ),
    }
})

const TRACE = "0af7651916cd43dd8448eb211c80319c"
const SPAN = "b7ad6b7169203331"
const OTHER_TRACE = "1bf8762a27de54ee9559fc322d91420d"

/** The spans the tracing API holds: the playground run's root span, and one of another trace. */
const spans = [
    {
        trace_id: TRACE,
        span_id: SPAN,
        parent_id: null,
        span_name: "completion",
        start_time: "2026-11-04T10:00:00Z",
        end_time: "2026-11-04T10:00:01Z",
        status_code: "STATUS_CODE_OK",
        attributes: {
            ag: {data: {inputs: {country: "France"}, outputs: "The capital of France is Paris."}},
        },
    },
    {
        trace_id: OTHER_TRACE,
        span_id: "c8be7c8279314442",
        parent_id: null,
        span_name: "completion",
        start_time: "2026-11-04T09:00:00Z",
        end_time: "2026-11-04T09:00:01Z",
        status_code: "STATUS_CODE_OK",
        attributes: {ag: {data: {inputs: {country: "Spain"}, outputs: "Madrid"}}},
    },
]

/** Answers a span query with the spans its filter names, by trace id or by span id. */
const answerSpans = async (request: unknown) => {
    const asked = JSON.stringify(request)
    const matched = spans.filter(
        (span) => asked.includes(span.trace_id) || asked.includes(span.span_id),
    )
    return {count: matched.length, spans: matched}
}

const routeHttp = () => {
    http.get.mockResolvedValue({data: {}})
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith("/workflows/query")) {
            return {data: {count: 1, workflows: [{id: "app-1", name: "Capitals", flags: {}}]}}
        }
        if (url.endsWith("/workflows/revisions/query")) {
            return {
                data: {
                    count: 1,
                    workflow_revisions: [completionRevision("Capital of {{country}}?")],
                },
            }
        }
        if (url.endsWith("/testsets/revisions/query") && body.testset_refs) {
            return {data: {testset_revisions: [{id: "ts-rev-3", testset_id: "ts-1", version: 3}]}}
        }
        if (url.endsWith("/testsets/revisions/query")) {
            return {
                data: {
                    testset_revisions: [
                        {
                            id: "ts-rev-3",
                            testset_id: "ts-1",
                            version: 3,
                            data: {
                                testcase_ids: ["tc-1"],
                                testcases: [
                                    {
                                        id: "tc-1",
                                        data: {inputs: {country: "Peru"}, outputs: "Lima"},
                                    },
                                ],
                            },
                        },
                    ],
                },
            }
        }
        if (url.endsWith("/testsets/revisions/commit")) {
            return {data: {testset_revision: {id: "ts-rev-4"}}}
        }
        return {data: {}}
    })
    api.querySpans.mockImplementation(answerSpans)
    api.queryTestsets.mockResolvedValue({testsets: [{id: "ts-1", name: "Capitals"}], count: 1})
    api.checkPermissions.mockResolvedValue({})
}

/** What the workflow service receives; it answers with the run's trace and root span. */
const runs: string[] = []

/** Waits until `done` holds: the full suite runs many files at once, so time varies. */
const until = async (done: () => unknown) => {
    for (let i = 0; i < 60 && !done(); i++) await settle()
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-700"

const Screen = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <PlaygroundRunPane revisionId={primaryRevisionId} />
    ) : null
}

const mount = async () => {
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    act(() =>
        root.render(
            <QueryClientProvider client={store.get(queryClientAtom)}>
                <Screen />
            </QueryClientProvider>,
        ),
    )
    await until(() => button(host, "Run all"))
}

const openMenu = async () => {
    const trigger = button(host, "Test set")
    expect(trigger, "the test set menu").toBeDefined()
    await act(async () => {
        trigger!.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
    await settle()
}
const menuItem = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (element) => element.textContent === label,
    )

const runFrance = async () => {
    const field = host.querySelector<HTMLTextAreaElement>(
        '[data-testid="input-variable-country"] textarea',
    )
    expect(field, "the country input").not.toBeNull()
    await typeInto(field!, "France")
    await act(async () => button(host, "Run all")!.click())
    await until(() => runs.length > 0)
    await settle()
}

const sheet = () => document.querySelector<HTMLElement>("[role=dialog]")
const choose = async (label: string, value: string) => {
    const element = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
    expect(element, label).not.toBeNull()
    await act(async () => {
        element!.value = value
        element!.dispatchEvent(new Event("change", {bubbles: true}))
    })
    await settle()
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    Element.prototype.scrollIntoView = vi.fn()
    stubResizeObserver()
    vi.clearAllMocks()
    routeHttp()
    runs.length = 0
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        if (!String(url).includes("/invoke")) return new Response("{}", {status: 404})
        runs.push(String(init.body))
        return new Response(
            JSON.stringify({
                data: "The capital of France is Paris.",
                trace_id: TRACE,
                span_id: SPAN,
            }),
            {status: 200},
        )
    })
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.replace.mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    store.set(executionItemController.actions.clearAll)
    store.set(playgroundController.actions.resetAll)
})

describe("Add to test set from the playground", {timeout: 30_000}, () => {
    it("Commits the run's inputs and outputs to the picked test set", async () => {
        await mount()
        await runFrance()
        expect(runs).toHaveLength(1)
        expect(runs[0]).toContain("France")

        await openMenu()
        const item = menuItem("Add to test set")
        expect(item, "the Add to test set item").toBeDefined()
        await act(async () => item!.click())
        await until(() => document.querySelector('select[aria-label="Test set"]'))
        expect(sheet()?.textContent).toContain("Add to test set")

        await choose("Test set", "ts-1")
        await until(() => button(sheet()!, "Commit")?.disabled === false)
        await act(async () => button(sheet()!, "Commit")!.click())
        await settle()

        const commits = http.post.mock.calls.filter(([url]) =>
            String(url).endsWith("/testsets/revisions/commit"),
        )
        expect(commits).toHaveLength(1)
        const revision = (
            commits[0][1] as {
                testset_revision: {
                    testset_id: string
                    revision_id: string
                    delta: {rows: {add: unknown[]}}
                }
            }
        ).testset_revision
        expect(revision.testset_id).toBe("ts-1")
        expect(revision.revision_id).toBe("ts-rev-3")
        // Exactly the one row that ran, with what the run recorded.
        expect(revision.delta.rows.add).toEqual([
            {
                data: {inputs: {country: "France"}, outputs: "The capital of France is Paris."},
                set_id: "ts-1",
            },
        ])
    })

    it("The item stays disabled until a run succeeds", async () => {
        await mount()

        await openMenu()

        const item = menuItem("Add to test set")
        expect(item, "the Add to test set item").toBeDefined()
        expect(item!.getAttribute("aria-disabled")).toBe("true")
    })

    it("A user who may not edit test sets gets no item", async () => {
        api.checkPermissions.mockRejectedValue(
            Object.assign(new Error("Forbidden"), {statusCode: 403}),
        )
        await mount()
        await runFrance()

        await openMenu()

        expect(menuItem("Connect test set")).toBeDefined()
        expect(menuItem("Add to test set")).toBeUndefined()
    })
})
