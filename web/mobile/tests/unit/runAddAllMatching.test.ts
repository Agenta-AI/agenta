// @vitest-environment jsdom
/**
 * "Add all matching to a queue" over the real package code: the real trace page fetcher, the real
 * scan pipeline (`addAllMatchingTracesToQueue`) and the real queue add request
 * (`addSimpleQueueTraces`). Only HTTP is replaced: `fetch` answers the trace query
 * the Fern client sends, and `axios` answers the queue add. Each test checks the exact requests.
 */
import type {ReactElement} from "react"

import type {Filter} from "@agenta/observability"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {http, message, modal, billing} = vi.hoisted(() => ({
    billing: {enabled: false},
    http: {get: vi.fn(), post: vi.fn()},
    message: {open: vi.fn(), destroy: vi.fn()},
    modal: {confirm: vi.fn()},
}))

vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        axios: Object.assign(Object.create(actual.axios), http),
        isBillingEnabled: () => billing.enabled,
    }
})
vi.mock("@agenta/ui/app-message", () => ({message, modal}))

import {
    confirmEveryTrace,
    runAddAllMatching,
    type AddAllMatchingInput,
} from "@/features/observability/queueAll/runAddAllMatching"

const PROJECT = "project-1"
const QUEUE = {id: "queue-1", name: "Weekly review"}

/** A span row as the spans query returns it. Two spans of one trace share the trace id. */
const span = (trace: number, at: number, part = 0) => ({
    trace_id: `trace-${trace}`,
    span_id: `span-${trace}-${part}`,
    span_name: "chat",
    start_time: new Date(Date.UTC(2026, 10, 1, 12, 0, 0) - at * 1000).toISOString(),
    end_time: new Date(Date.UTC(2026, 10, 1, 12, 0, 1) - at * 1000).toISOString(),
})

/** `count` spans of distinct traces, numbered from `first`, each one second older. */
const page = (first: number, count: number) =>
    Array.from({length: count}, (_, index) => span(first + index, first + index))

let pages: unknown[][] = []
/** The trace query answers with this error response for the request number it is set for. */
let failedReads = new Map<number, () => Response>()
const errorResponse =
    (status: number, headers: Record<string, string> = {}) =>
    () =>
        new Response(JSON.stringify({detail: "trace store unavailable"}), {
            status,
            headers: {"content-type": "application/json", ...headers},
        })
const traceRequests: {url: URL; body: Record<string, unknown>}[] = []
/** While set, the second trace page waits for it, so a test can act mid-scan. */
let holdSecondPage: Promise<void> | null = null

const stubTraceQuery = () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : String(input))
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        traceRequests.push({url, body})
        if (traceRequests.length === 2 && holdSecondPage) await holdSecondPage
        const failure = failedReads.get(traceRequests.length)
        if (failure) return failure()
        const spans = pages[traceRequests.length - 1] ?? []
        return new Response(JSON.stringify({count: spans.length, spans}), {
            status: 200,
            headers: {"content-type": "application/json"},
        })
    })
}

/** The queue add answers like the API: the queue id, or the error the test sets for a call. */
let addFailures = new Map<number, unknown>()
/** While set, the first queue add waits for it, so a test can act while a write is in flight. */
let holdFirstAdd: Promise<void> | null = null
const addCalls = () =>
    http.post.mock.calls
        .filter(([url]) => /\/simple\/queues\/[^/]+\/traces\/$/.test(String(url)))
        .map(([url, body, config]) => ({url, body, config}))

const filters: Filter[] = [{field: "span_name", operator: "is", value: "chat"}]

const input = (overrides: Partial<AddAllMatchingInput> = {}): AddAllMatchingInput => ({
    queue: QUEUE,
    projectId: PROJECT,
    appId: "",
    filters,
    sort: undefined,
    traceTabs: "span",
    pageSignal: new AbortController().signal,
    ...overrides,
})

interface Shown {
    type: string
    title: string
    description: string
    duration: number
    action?: {label: string; onClick: () => void}
}

/** Every toast the run showed, in order, as its type, text, duration and button. */
const shown = (): Shown[] =>
    message.open.mock.calls.map(([args]) => ({
        type: args.type,
        ...(args.content as ReactElement<{title: string; description: string}>).props,
        duration: args.duration,
        action: args.action,
    }))
const last = (type: string) =>
    shown()
        .filter((toast) => toast.type === type)
        .at(-1)

beforeEach(() => {
    const store = getDefaultStore()
    queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT)
    pages = []
    failedReads = new Map()
    traceRequests.length = 0
    holdSecondPage = null
    holdFirstAdd = null
    addFailures = new Map()
    message.open.mockReset()
    modal.confirm.mockReset()
    message.destroy.mockReset()
    billing.enabled = false
    http.get.mockReset()
    http.post.mockReset()
    http.post.mockImplementation(async (url: string) => {
        if (!url.endsWith("/traces/")) return {data: {count: 0, queues: []}}
        const call = addCalls().length
        if (call === 1 && holdFirstAdd) await holdFirstAdd
        const failure = addFailures.get(call)
        if (failure) throw failure
        return {data: {count: 1, queue_id: url.split("/")[5]}}
    })
    stubTraceQuery()
})

afterEach(() => {
    vi.unstubAllGlobals()
    getDefaultStore().set(projectIdAtom, null)
})

let queryClient: QueryClient

describe("Add all matching to a queue", () => {
    it("Picking a queue scans every matching page and adds their trace ids", async () => {
        // Two pages of 200 traces; one trace shows up on both pages (the cursor overlaps by
        // design) and one trace has two spans. Then an empty page ends the scan.
        pages = [[...page(0, 200), span(5, 5, 1)], [span(199, 199, 2), ...page(200, 200)], []]

        await runAddAllMatching(input())

        expect(traceRequests).toHaveLength(3)
        // The second request starts just after the oldest span of the first page.
        const oldestFirst = Date.parse(span(199, 199).start_time)
        expect((traceRequests[1].body.windowing as {newest: string}).newest).toBe(
            new Date(oldestFirst + 1).toISOString(),
        )

        const ids = (from: number, to: number) =>
            Array.from({length: to - from}, (_, index) => `trace-${from + index}`)
        expect(addCalls()).toEqual([
            {
                url: expect.stringMatching(/\/simple\/queues\/queue-1\/traces\/$/),
                body: {trace_ids: ids(0, 250)},
                config: {params: {project_id: PROJECT}},
            },
            {
                url: expect.stringMatching(/\/simple\/queues\/queue-1\/traces\/$/),
                body: {trace_ids: ids(250, 400)},
                config: {params: {project_id: PROJECT}},
            },
        ])
        expect(last("success")).toMatchObject({
            title: "Queued 400 traces",
            description: `Queued to "Weekly review". They'll appear as the queue processes.`,
        })
    })

    it("The scan carries the app scope and the active filters", async () => {
        pages = [page(0, 3), []]

        await runAddAllMatching(input({appId: "app-7"}))

        const [{url, body}] = traceRequests
        expect(url.pathname).toMatch(/\/spans\/query$/)
        expect(url.searchParams.get("project_id")).toBe(PROJECT)
        expect(url.searchParams.get("application_id")).toBe("app-7")
        expect(body.filtering).toEqual({
            conditions: [{field: "span_name", operator: "is", value: "chat"}],
        })
        expect(body.windowing).toMatchObject({limit: 500})
        expect(addCalls().map((call) => call.body)).toEqual([
            {trace_ids: ["trace-0", "trace-1", "trace-2"]},
        ])
    })

    it("Cancel stops the scan and reports how many were queued", async () => {
        pages = [page(0, 300), page(300, 100), []]
        let release: () => void = () => undefined
        holdSecondPage = new Promise((resolve) => (release = resolve))

        const running = runAddAllMatching(input())
        await vi.waitFor(() => expect(traceRequests).toHaveLength(2))
        expect(last("loading")).toMatchObject({
            title: `Queuing traces to "Weekly review"`,
            description: "Queued 250 of up to 1,000 traces…",
        })
        last("loading")?.action?.onClick()
        release()
        await running

        expect(traceRequests).toHaveLength(2)
        expect(addCalls()).toHaveLength(1)
        expect(last("warning")).toMatchObject({
            title: "Cancelled",
            description: `250 traces queued to "Weekly review" before you stopped.`,
        })
        expect(last("success")).toBeUndefined()
    })

    it("Cancel during a write sends no further batch", async () => {
        pages = [page(0, 500), []]
        let release: () => void = () => undefined
        holdFirstAdd = new Promise((resolve) => (release = resolve))

        const running = runAddAllMatching(input())
        await vi.waitFor(() => expect(addCalls()).toHaveLength(1))
        last("loading")?.action?.onClick()
        release()
        await running

        expect(addCalls()).toHaveLength(1)
        expect(last("warning")).toMatchObject({
            title: "Cancelled",
            description: `250 traces queued to "Weekly review" before you stopped.`,
        })
    })

    it("A partial failure shows Queue add incomplete with Retry", async () => {
        pages = [page(0, 300), [], page(0, 300), []]
        addFailures.set(
            2,
            Object.assign(new Error("Request failed with status code 500"), {
                response: {status: 500, data: {detail: "queue store unavailable"}},
            }),
        )

        await runAddAllMatching(input())

        expect(
            addCalls().map((call) => (call.body as {trace_ids: string[]}).trace_ids.length),
        ).toEqual([250, 50])
        const shown = last("error")
        expect(shown).toMatchObject({
            title: "Queue add incomplete",
            description: "Queued 250 traces; 50 failed to queue.",
        })
        expect(JSON.stringify(shown?.description)).not.toContain("queue store unavailable")

        // Retry scans again from the first page and sends only the traces that were not added.
        shown?.action?.onClick()
        await vi.waitFor(() => expect(last("success")).toBeDefined())
        expect(traceRequests).toHaveLength(4)
        const newest = (index: number) =>
            Date.parse((traceRequests[index].body.windowing as {newest: string}).newest)
        expect(newest(2)).toBeGreaterThanOrEqual(newest(0))
        const ids = (from: number, to: number) =>
            Array.from({length: to - from}, (_, index) => `trace-${from + index}`)
        expect(addCalls().map((call) => call.body)).toEqual([
            {trace_ids: ids(0, 250)},
            {trace_ids: ids(250, 300)},
            {trace_ids: ids(250, 300)},
        ])
        expect(last("success")).toMatchObject({title: "Queued 300 traces"})
    })

    it("A failed page read stops the scan as failed, and Retry sends only the rest", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
        // The second page read fails. The first run of Retry finds ten more traces.
        pages = [page(0, 300), [], page(0, 310), []]
        failedReads.set(2, errorResponse(400))

        await runAddAllMatching(input())

        expect(traceRequests).toHaveLength(2)
        const ids = (from: number, to: number) =>
            Array.from({length: to - from}, (_, index) => `trace-${from + index}`)
        // The traces read before the failure are still added.
        expect(addCalls().map((call) => call.body)).toEqual([
            {trace_ids: ids(0, 250)},
            {trace_ids: ids(250, 300)},
        ])
        expect(last("success")).toBeUndefined()
        const failed = last("error")
        expect(failed).toMatchObject({
            title: "Queue add failed",
            description: "Something went wrong. Try again.",
            action: {label: "Retry"},
        })
        expect(logged).toHaveBeenCalled()

        failed?.action?.onClick()
        await vi.waitFor(() => expect(last("success")).toBeDefined())
        expect(traceRequests).toHaveLength(4)
        expect(addCalls().map((call) => call.body)).toEqual([
            {trace_ids: ids(0, 250)},
            {trace_ids: ids(250, 300)},
            {trace_ids: ids(300, 310)},
        ])
        expect(last("success")).toMatchObject({title: "Queued 310 traces"})
    })

    it("A rate limited page read pauses, says so, and goes on", async () => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]})
        try {
            // The client retries a 429 three times by itself; the fourth 429 reaches the scan.
            pages = [page(0, 2), [], [], [], [], []]
            for (const request of [2, 3, 4, 5]) {
                failedReads.set(request, errorResponse(429, {"retry-after": "1"}))
            }

            let finished = false
            const running = runAddAllMatching(input()).finally(() => (finished = true))
            while (!finished) await vi.advanceTimersByTimeAsync(500)
            await running

            expect(traceRequests).toHaveLength(6)
            expect(shown()).toContainEqual(
                expect.objectContaining({
                    title: "Rate limited, pausing",
                    description:
                        "Queued 0 of up to 1,000 traces. The server is throttling requests; retrying in 1s…",
                }),
            )
            expect(addCalls().map((call) => call.body)).toEqual([
                {trace_ids: ["trace-0", "trace-1"]},
            ])
            expect(last("success")).toMatchObject({title: "Queued 2 traces"})
        } finally {
            vi.useRealTimers()
        }
    })

    it("The run stops at the plan cap and says so", async () => {
        pages = [page(0, 600), page(600, 600), page(1200, 10), []]

        await runAddAllMatching(input())

        expect(traceRequests).toHaveLength(2)
        const sent = addCalls().flatMap((call) => (call.body as {trace_ids: string[]}).trace_ids)
        expect(sent).toHaveLength(1000)
        expect(new Set(sent).size).toBe(1000)
        expect(last("success")).toMatchObject({
            title: "Queued 1,000 traces",
            description:
                `Queued to "Weekly review". Hit the 1,000-trace limit for one run. ` +
                `Narrow the filter to queue the rest. They'll appear as the queue processes.`,
        })
    })

    it("A rate limited add pauses, says so, and goes on", async () => {
        pages = [page(0, 2), []]
        addFailures.set(
            1,
            Object.assign(new Error("Request failed with status code 429"), {
                response: {status: 429, headers: {"retry-after": "1"}},
            }),
        )

        await runAddAllMatching(input())

        expect(shown()).toContainEqual(
            expect.objectContaining({
                title: "Rate limited, pausing",
                description:
                    "Queued 0 of up to 1,000 traces. The server is throttling requests; retrying in 1s…",
            }),
        )
        expect(addCalls().map((call) => call.body)).toEqual([
            {trace_ids: ["trace-0", "trace-1"]},
            {trace_ids: ["trace-0", "trace-1"]},
        ])
        expect(last("success")).toMatchObject({title: "Queued 2 traces"})
    })

    it("No matching trace says nothing was queued", async () => {
        pages = [[]]

        await runAddAllMatching(input())

        expect(http.post).not.toHaveBeenCalled()
        expect(last("info")).toMatchObject({
            title: "Nothing queued",
            description: "No traces match this filter, so nothing was queued.",
        })
    })

    it("View queue appears only when the host can open the queue", async () => {
        pages = [page(0, 1), []]
        const onViewQueue = vi.fn()

        await runAddAllMatching(input({onViewQueue}))
        last("success")?.action?.onClick()
        expect(onViewQueue).toHaveBeenCalledWith("queue-1")

        pages = [page(0, 1), []]
        traceRequests.length = 0
        await runAddAllMatching(input())
        expect(last("success")?.action).toBeUndefined()
    })

    it("A newer run silences the run it replaced", async () => {
        pages = [page(0, 300), page(300, 10), page(0, 1), []]
        let release: () => void = () => undefined
        holdSecondPage = new Promise((resolve) => (release = resolve))
        const shared = input()

        const first = runAddAllMatching(shared)
        await vi.waitFor(() => expect(traceRequests).toHaveLength(2))
        const second = runAddAllMatching({...shared, queue: {id: "queue-2", name: "Spot checks"}})
        release()
        await Promise.all([first, second])

        expect(last("warning")).toBeUndefined()
        expect(shown().filter((toast) => toast.type === "success")).toHaveLength(1)
        expect(last("success")).toMatchObject({
            description: `Queued to "Spot checks". They'll appear as the queue processes.`,
        })
        // Both runs use one toast, so the replaced run leaves no spinner behind.
        expect(new Set(message.open.mock.calls.map(([args]) => args.key)).size).toBe(1)
    })

    it("Leaving the page stops the scan and clears its toast", async () => {
        pages = [page(0, 300), page(300, 100), []]
        let release: () => void = () => undefined
        holdSecondPage = new Promise((resolve) => (release = resolve))
        const leave = new AbortController()

        const running = runAddAllMatching(input({pageSignal: leave.signal}))
        await vi.waitFor(() => expect(traceRequests).toHaveLength(2))
        leave.abort()
        release()
        await running

        expect(traceRequests).toHaveLength(2)
        expect(addCalls()).toHaveLength(1)
        expect(message.destroy).toHaveBeenCalledWith("queue-all-matching")
        expect(last("warning")).toBeUndefined()
    })

    it("The cap comes from the plan when billing is on", async () => {
        billing.enabled = true
        http.get.mockResolvedValue({data: {plan: "cloud_v0_pro"}})
        pages = [page(0, 1), []]

        await runAddAllMatching(input())

        expect(http.get).toHaveBeenCalledWith(expect.stringMatching(/\/billing\/subscription$/), {
            params: {project_id: PROJECT},
        })
        expect(shown()[0]).toMatchObject({description: "Queued 0 of up to 2,500 traces…"})
    })

    it("A run marks the queue pages stale, so they show the new items", async () => {
        pages = [page(0, 2), []]
        const invalidate = vi.spyOn(queryClient, "invalidateQueries")

        await runAddAllMatching(input())

        expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
            {queryKey: ["simpleQueue", "queue-1"], exact: true},
            {queryKey: ["simpleQueue", "scenarioProgress", "queue-1"]},
            {queryKey: ["simpleQueues", "list"]},
        ])
    })

    it("No filter asks before queuing every trace", async () => {
        const answer = confirmEveryTrace()
        expect(modal.confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "Add every trace to the queue?",
                content:
                    "No filter is active. This will queue every trace in the project. Continue?",
                okText: "Continue",
                cancelText: "Cancel",
            }),
        )
        modal.confirm.mock.calls[0][0].onCancel()
        await expect(answer).resolves.toBe(false)
    })
})
