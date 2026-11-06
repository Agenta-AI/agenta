import {act, type ReactElement} from "react"

import {buildTraceQueryParams} from "@agenta/observability"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {atom, getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {http, notification} = vi.hoisted(() => ({
    http: {get: vi.fn(), post: vi.fn()},
    notification: {
        open: vi.fn(),
        destroy: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    },
}))

vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/ui/app-message", () => ({notification}))
vi.mock("@/oss/state/access/atoms", () => ({queueMaxItemsAtom: atom(1000)}))

import {useBatchAddTracesToQueue, type BatchAddRunInput} from "./useBatchAddTracesToQueue"

/**
 * "Add all matching to queue" over the real package code: the real trace page fetcher, the real
 * scan pipeline and the real queue add request. Only HTTP is replaced: `fetch` answers the trace
 * query, and `axios` answers the queue add.
 */
const PROJECT = "project-1"
const QUEUE = {id: "queue-1", name: "Weekly review"} as BatchAddRunInput["queue"]

const span = (trace: number) => ({
    trace_id: `trace-${trace}`,
    span_id: `span-${trace}`,
    span_name: "chat",
    start_time: new Date(Date.UTC(2026, 10, 1, 12, 0, 0) - trace * 1000).toISOString(),
    end_time: new Date(Date.UTC(2026, 10, 1, 12, 0, 1) - trace * 1000).toISOString(),
})
const page = (first: number, count: number) =>
    Array.from({length: count}, (_, index) => span(first + index))
const ids = (from: number, to: number) =>
    Array.from({length: to - from}, (_, index) => `trace-${from + index}`)

let pages: unknown[][] = []
let traceReads = 0
/** The queue add answers with this error for the call number it is set for. */
let addFailures = new Map<number, unknown>()
const addCalls = () =>
    http.post.mock.calls
        .filter(([url]) => /\/simple\/queues\/[^/]+\/traces\/$/.test(String(url)))
        .map(([, body]) => body)

let run: (input: BatchAddRunInput) => void = () => undefined
const Probe = () => {
    run = useBatchAddTracesToQueue()
    return null
}

const input = (): BatchAddRunInput => {
    const query = buildTraceQueryParams(
        [{field: "span_name", operator: "is", value: "chat"}],
        undefined,
        "span",
        undefined,
    )
    return {
        queue: QUEUE,
        scanConfig: {
            params: query.params,
            appId: "",
            projectId: PROJECT,
            isHasAnnotationSelected: query.isHasAnnotationSelected,
            hasAnnotationConditions: query.hasAnnotationConditions,
            hasAnnotationOperator: query.hasAnnotationOperator,
        },
    }
}

/** Waits until the run shows a toast of this kind, and returns its arguments. */
const toast = async (kind: keyof typeof notification) => {
    await vi.waitFor(() => expect(notification[kind]).toHaveBeenCalled())
    return notification[kind].mock.calls.at(-1)?.[0] as {
        message: string
        description: string
        btn?: ReactElement<{onClick: () => void}>
    }
}

describe("useBatchAddTracesToQueue", () => {
    let root: Root

    beforeEach(() => {
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        const store = getDefaultStore()
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(projectIdAtom, PROJECT)
        pages = []
        traceReads = 0
        addFailures = new Map()
        Object.values(notification).forEach((fn) => fn.mockReset())
        http.get.mockReset()
        http.post.mockReset()
        http.post.mockImplementation(async (url: string) => {
            if (!url.endsWith("/traces/")) return {data: {count: 0, queues: []}}
            const failure = addFailures.get(addCalls().length)
            if (failure) throw failure
            return {data: {count: 1, queue_id: url.split("/")[5]}}
        })
        vi.stubGlobal("fetch", async () => {
            const spans = pages[traceReads] ?? []
            traceReads += 1
            return new Response(JSON.stringify({count: spans.length, spans}), {
                status: 200,
                headers: {"content-type": "application/json"},
            })
        })
        root = createRoot(document.createElement("div"))
        act(() =>
            root.render(
                <Provider store={store}>
                    <Probe />
                </Provider>,
            ),
        )
    })

    afterEach(() => {
        act(() => root.unmount())
        vi.unstubAllGlobals()
        getDefaultStore().set(projectIdAtom, null)
    })

    it("Retry after a partial failure sends only the traces that were not queued", async () => {
        // 300 traces: the first batch of 250 is queued, the batch of the last 50 fails.
        pages = [page(0, 300), [], page(0, 300), []]
        addFailures.set(
            2,
            Object.assign(new Error("Request failed with status code 500"), {
                response: {status: 500, data: {detail: "queue store unavailable"}},
            }),
        )

        act(() => run(input()))
        const failed = await toast("error")
        expect(failed).toMatchObject({
            message: "Queue add incomplete",
            description: "Queued 250 traces; 50 failed to queue.",
        })

        act(() => failed.btn?.props.onClick())
        const done = await toast("success")

        expect(addCalls()).toEqual([
            {trace_ids: ids(0, 250)},
            {trace_ids: ids(250, 300)},
            {trace_ids: ids(250, 300)},
        ])
        expect(done).toMatchObject({message: "Queued 300 traces"})
    })
})
