// @vitest-environment jsdom
/**
 * "Add all matching to a queue" over the real package code: the real trace page fetcher, the real
 * scan pipeline (`addAllMatchingTracesToQueue`) and the real queue add
 * (`simpleQueueMolecule.set.addTraces`). Only HTTP is replaced: `fetch` answers the trace query
 * the Fern client sends, and `axios` answers the queue add. Each test checks the exact requests.
 */
import type {ReactElement} from "react"

import {buildTraceQueryParams, type Filter} from "@agenta/observability"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {http, notification} = vi.hoisted(() => ({
    http: {get: vi.fn(), post: vi.fn()},
    notification: {
        open: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        destroy: vi.fn(),
    },
}))

vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/ui/app-message", () => ({
    notification,
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn()},
}))

import {
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
const traceRequests: {url: URL; body: Record<string, unknown>}[] = []
/** While set, the second trace page waits for it, so a test can act mid-scan. */
let holdSecondPage: Promise<void> | null = null

const stubTraceQuery = () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : String(input))
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        traceRequests.push({url, body})
        if (traceRequests.length === 2 && holdSecondPage) await holdSecondPage
        const spans = pages[traceRequests.length - 1] ?? []
        return new Response(JSON.stringify({count: spans.length, spans}), {
            status: 200,
            headers: {"content-type": "application/json"},
        })
    })
}

/** The queue add answers like the API: the queue id, or the error the test sets for a call. */
let addFailures = new Map<number, unknown>()
const addCalls = () =>
    http.post.mock.calls
        .filter(([url]) => /\/simple\/queues\/[^/]+\/traces\/$/.test(String(url)))
        .map(([url, body, config]) => ({url, body, config}))

const filters: Filter[] = [{field: "span_name", operator: "is", value: "chat"}]

const input = (overrides: Partial<AddAllMatchingInput> = {}): AddAllMatchingInput => {
    let current: AbortController | null = null
    return {
        queue: QUEUE,
        projectId: PROJECT,
        appId: "",
        query: buildTraceQueryParams(filters, undefined, "span"),
        run: {
            begin: () => {
                current?.abort()
                current = new AbortController()
                return current
            },
            owns: (controller) => controller === current,
        },
        ...overrides,
    }
}

/** The last notification each kind showed, as `{message, description}`. */
const last = (kind: keyof typeof notification) => {
    const calls = notification[kind].mock.calls
    return calls[calls.length - 1]?.[0] as
        | {message: string; description: string; btn?: ReactElement<{onClick: () => void}>}
        | undefined
}

beforeEach(() => {
    const store = getDefaultStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, PROJECT)
    pages = []
    traceRequests.length = 0
    holdSecondPage = null
    addFailures = new Map()
    for (const fn of Object.values(notification)) fn.mockReset()
    http.get.mockReset()
    http.post.mockReset()
    http.post.mockImplementation(async (url: string) => {
        if (!url.endsWith("/traces/")) return {data: {count: 0, queues: []}}
        const call = addCalls().length
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
            message: "Queued 400 traces",
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
        expect(last("open")).toMatchObject({
            message: `Queuing traces to "Weekly review"`,
            description: "Queued 250 of up to 1,000 traces…",
        })
        last("open")?.btn?.props.onClick()
        release()
        await running

        expect(traceRequests).toHaveLength(2)
        expect(addCalls()).toHaveLength(1)
        expect(last("warning")).toMatchObject({
            message: "Cancelled",
            description: `250 traces queued to "Weekly review" before you stopped.`,
        })
        expect(notification.success).not.toHaveBeenCalled()
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
            message: "Queue add incomplete",
            description: "Queued 250 traces; 50 failed to queue.",
        })
        expect(JSON.stringify(shown?.description)).not.toContain("queue store unavailable")

        // Retry runs the whole scan again from the first page.
        shown?.btn?.props.onClick()
        await vi.waitFor(() => expect(notification.success).toHaveBeenCalled())
        expect(traceRequests).toHaveLength(4)
        const newest = (index: number) =>
            Date.parse((traceRequests[index].body.windowing as {newest: string}).newest)
        expect(newest(2)).toBeGreaterThanOrEqual(newest(0))
        expect(
            addCalls().map((call) => (call.body as {trace_ids: string[]}).trace_ids.length),
        ).toEqual([250, 50, 250, 50])
        expect(last("success")).toMatchObject({message: "Queued 300 traces"})
    })

    it("The run stops at the plan cap and says so", async () => {
        pages = [page(0, 600), page(600, 600), page(1200, 10), []]

        await runAddAllMatching(input())

        expect(traceRequests).toHaveLength(2)
        const sent = addCalls().flatMap((call) => (call.body as {trace_ids: string[]}).trace_ids)
        expect(sent).toHaveLength(1000)
        expect(new Set(sent).size).toBe(1000)
        expect(last("success")).toMatchObject({
            message: "Queued 1,000 traces",
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

        expect(notification.open).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "Rate limited, pausing",
                description:
                    "Queued 0 of up to 1,000 traces. The server is throttling requests; retrying in 1s…",
            }),
        )
        expect(addCalls().map((call) => call.body)).toEqual([
            {trace_ids: ["trace-0", "trace-1"]},
            {trace_ids: ["trace-0", "trace-1"]},
        ])
        expect(last("success")).toMatchObject({message: "Queued 2 traces"})
    })

    it("No matching trace says nothing was queued", async () => {
        pages = [[]]

        await runAddAllMatching(input())

        expect(http.post).not.toHaveBeenCalled()
        expect(last("info")).toMatchObject({
            message: "Nothing queued",
            description: "No traces match this filter, so nothing was queued.",
        })
    })

    it("View queue appears only when the host can open the queue", async () => {
        pages = [page(0, 1), []]
        const onViewQueue = vi.fn()

        await runAddAllMatching(input({onViewQueue}))
        last("success")?.btn?.props.onClick()
        expect(onViewQueue).toHaveBeenCalledWith("queue-1")

        pages = [page(0, 1), []]
        traceRequests.length = 0
        await runAddAllMatching(input())
        expect(last("success")?.btn).toBeUndefined()
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

        expect(notification.warning).not.toHaveBeenCalled()
        expect(notification.success).toHaveBeenCalledTimes(1)
        expect(last("success")).toMatchObject({
            description: `Queued to "Spot checks". They'll appear as the queue processes.`,
        })
    })
})
