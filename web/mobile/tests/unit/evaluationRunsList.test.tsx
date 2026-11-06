// @vitest-environment jsdom
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    parseKindTab,
    parseStatuses,
    useEvaluationRunsFilters,
    type EvaluationKindTab,
} from "@/features/evaluations/list/useEvaluationRunsFilters"
import {useEvaluationRunsList} from "@/features/evaluations/list/useEvaluationRunsList"

import {makeRun, page} from "./evaluationRunsFixtures"

const http = vi.hoisted(() => ({post: vi.fn()}))
const router = vi.hoisted(() => ({
    query: {} as Record<string, string | undefined>,
    replace: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("next/router", () => ({
    useRouter: () => ({query: router.query, pathname: "/evaluations", replace: router.replace}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const realSetTimeout = globalThis.setTimeout

let host: HTMLDivElement
let root: Root
let client: QueryClient
let latest: ReturnType<typeof useEvaluationRunsList>

const Probe = ({
    kind = "all",
    appId = null,
    search = "",
    statuses = [],
}: {
    kind?: EvaluationKindTab
    appId?: string | null
    search?: string
    statuses?: string[]
}) => {
    latest = useEvaluationRunsList({projectId: "pr", kind, appId, search, statuses})
    return null
}

const mount = async (props: Parameters<typeof Probe>[0] = {}) => {
    await act(async () => {
        root.render(createElement(QueryClientProvider, {client}, createElement(Probe, props)))
    })
    // The query client hands results to React on a timer, so wait on a real one.
    for (let turn = 0; turn < 20 && (turn < 2 || latest.isPending); turn++) {
        await act(async () => {
            await new Promise((resolve) => realSetTimeout(resolve, 0))
        })
    }
}

const bodies = () => http.post.mock.calls.map((call) => call[1] as Record<string, unknown>)

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    http.post.mockReset()
    router.replace.mockReset()
    router.query = {}
})

afterEach(() => {
    vi.useRealTimers()
    act(() => root.unmount())
    host.remove()
})

describe("evaluation runs filters", () => {
    it("An unknown kind in the URL reads as all", () => {
        expect(parseKindTab("nonsense", false)).toBe("all")
        expect(parseKindTab(null, false)).toBe("all")
        expect(parseKindTab("human", false)).toBe("human")
    })

    it("App scope drops the online kind", () => {
        expect(parseKindTab("online", true)).toBe("all")
        expect(parseKindTab("online", false)).toBe("online")
    })

    it("Statuses keep only the known values, in menu order", () => {
        expect(parseStatuses("success,bogus,pending")).toEqual(["pending", "success"])
        expect(parseStatuses(null)).toEqual([])
    })

    it("A write replaces the URL and an all kind removes the parameter", async () => {
        router.query = {kind: "human", q: "alpha"}
        let filters!: ReturnType<typeof useEvaluationRunsFilters>
        const Host = () => {
            filters = useEvaluationRunsFilters()
            return null
        }
        await act(async () => root.render(createElement(Host)))
        expect(filters.kind).toBe("human")
        expect(filters.search).toBe("alpha")
        act(() => filters.setKind("all"))
        expect(router.replace).toHaveBeenCalledWith(
            {pathname: "/evaluations", query: {q: "alpha"}},
            undefined,
            {shallow: true},
        )
    })
})

describe("evaluation runs list", () => {
    it("The first page request carries the search as run.name and the statuses", async () => {
        http.post.mockResolvedValue(page([makeRun("a")]))
        await mount({search: " alpha ", statuses: ["running", "queued"]})
        const [body] = bodies()
        expect(http.post.mock.calls[0][0]).toBe("https://api.test/evaluations/runs/query")
        expect(body.run).toEqual({
            name: "alpha",
            statuses: ["running", "queued"],
            flags: {has_testcases: false, has_traces: false},
        })
        expect((body.windowing as {limit: number}).limit).toBe(30)
        expect(latest.runs.map((run) => run.id)).toEqual(["a"])
    })

    it("The kind tab keeps only runs of that kind and still fills the page", async () => {
        http.post
            .mockResolvedValueOnce(page([makeRun("a"), makeRun("h1", {kind: "human"})], "cursor-1"))
            .mockResolvedValueOnce(page([makeRun("h2", {kind: "human"})]))
        await mount({kind: "human"})
        expect(latest.runs.map((run) => run.id)).toEqual(["h1", "h2"])
        expect(http.post).toHaveBeenCalledTimes(2)
    })

    it("The app filter is sent as the application reference", async () => {
        http.post.mockResolvedValue(page([]))
        await mount({appId: "app-1"})
        expect(bodies()[0].run).toEqual({
            references: [{application: {id: "app-1"}}],
            flags: {has_testcases: false, has_traces: false},
        })
    })

    it("Load more sends the cursor of the last page", async () => {
        http.post
            .mockResolvedValueOnce(page([makeRun("a")], "cursor-1"))
            .mockResolvedValueOnce(page([makeRun("b")]))
        await mount()
        expect(latest.hasNextPage).toBe(true)
        await act(async () => {
            await latest.fetchNextPage()
        })
        await act(async () => {
            await new Promise((resolve) => realSetTimeout(resolve, 0))
        })
        expect((bodies()[1].windowing as {next: string}).next).toBe("cursor-1")
        expect(latest.runs.map((run) => run.id)).toEqual(["a", "b"])
        expect(latest.hasNextPage).toBe(false)
    })

    it("Loaded runs are seeded into the evaluation run cache", async () => {
        http.post.mockResolvedValue(page([makeRun("a")]))
        await mount()
        expect(client.getQueryData(["evaluationRun", "a"])).toMatchObject({id: "a"})
    })

    it("A failed first load is an error with no rows", async () => {
        http.post.mockRejectedValueOnce(new Error("boom"))
        await mount()
        expect(latest.isError).toBe(true)
        expect(latest.runs).toEqual([])
    })

    describe("polling", () => {
        const advance = async (ms: number) => {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(ms)
            })
        }

        it("The list polls every five seconds while an auto run is running", async () => {
            vi.useFakeTimers()
            http.post.mockResolvedValue(page([makeRun("a", {status: "running"})]))
            await mount()
            expect(http.post).toHaveBeenCalledTimes(1)
            await advance(5_000)
            expect(http.post).toHaveBeenCalledTimes(2)
            await advance(5_000)
            expect(http.post).toHaveBeenCalledTimes(3)
        })

        it("A queued run polls too", async () => {
            vi.useFakeTimers()
            http.post.mockResolvedValue(page([makeRun("a", {status: "queued"})]))
            await mount()
            await advance(5_000)
            expect(http.post).toHaveBeenCalledTimes(2)
        })

        it("A live run that is running does not start polling", async () => {
            vi.useFakeTimers()
            http.post.mockResolvedValue(
                page([makeRun("a", {status: "running", live: true, flags: {is_active: true}})]),
            )
            await mount()
            await advance(20_000)
            expect(http.post).toHaveBeenCalledTimes(1)
        })

        it("A finished run does not poll", async () => {
            vi.useFakeTimers()
            http.post.mockResolvedValue(page([makeRun("a", {status: "success"})]))
            await mount()
            await advance(20_000)
            expect(http.post).toHaveBeenCalledTimes(1)
        })
    })
})
