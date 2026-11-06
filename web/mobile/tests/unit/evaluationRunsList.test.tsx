// @vitest-environment jsdom
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    EMPTY_RUN_FILTERS,
    parseKindTab,
    parseStatuses,
    useEvaluationRunsFilters,
    type EvaluationKindTab,
    type RunFilterValues,
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
    panel = {},
}: {
    kind?: EvaluationKindTab
    appId?: string | null
    search?: string
    statuses?: string[]
    panel?: Partial<RunFilterValues>
}) => {
    latest = useEvaluationRunsList({
        projectId: "pr",
        kind,
        appId,
        search,
        panel: {...EMPTY_RUN_FILTERS, statuses, ...panel},
    })
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

describe("the filter panel in the URL", () => {
    let filters!: ReturnType<typeof useEvaluationRunsFilters>
    const Host = () => {
        filters = useEvaluationRunsFilters()
        return null
    }
    const lastQuery = () => router.replace.mock.calls.at(-1)?.[0].query

    it("Every field is read from the URL, unknown values dropped", async () => {
        router.query = {
            app: "app-1",
            status: "success",
            types: "human,bogus,auto",
            evaluator: "ev-1,ev-2",
            testset: "ts-1",
            query: "q-1",
            variant: "var-1",
            range: "7 days",
        }
        await act(async () => root.render(createElement(Host)))
        expect(filters.panel).toEqual({
            statuses: ["success"],
            types: ["auto", "human"],
            references: {
                evaluator: ["ev-1", "ev-2"],
                testset: ["ts-1"],
                query: ["q-1"],
                variant: ["var-1"],
            },
            range: "7 days",
        })
    })

    it("Variants need an app: without one they filter nothing", async () => {
        router.query = {variant: "var-1", range: "forever"}
        await act(async () => root.render(createElement(Host)))
        expect(filters.panel.references.variant).toEqual([])
        expect(filters.panel.range).toBeNull()
    })

    it("Apply writes every field and an empty field removes its parameter", async () => {
        router.query = {q: "alpha", testset: "ts-old"}
        await act(async () => root.render(createElement(Host)))
        act(() =>
            filters.setPanel({
                ...EMPTY_RUN_FILTERS,
                statuses: ["failure"],
                references: {...EMPTY_RUN_FILTERS.references, evaluator: ["ev-1", "ev-2"]},
                range: "24 hours",
            }),
        )
        expect(lastQuery()).toEqual({
            q: "alpha",
            status: "failure",
            evaluator: "ev-1,ev-2",
            range: "24 hours",
        })
    })

    it("Another app drops the variants of the old one", async () => {
        router.query = {app: "app-1", variant: "var-1", evaluator: "ev-1"}
        await act(async () => root.render(createElement(Host)))
        act(() => filters.setAppId("app-2"))
        expect(lastQuery()).toEqual({app: "app-2", evaluator: "ev-1"})
    })

    it("Clear removes the search and every panel filter, and keeps the app and tab", async () => {
        router.query = {app: "app-1", kind: "auto", q: "x", status: "success", evaluator: "e"}
        await act(async () => root.render(createElement(Host)))
        act(() => filters.clearFilters())
        expect(lastQuery()).toEqual({app: "app-1", kind: "auto"})
    })
})

describe("evaluation runs list", () => {
    it("Evaluators, test sets, queries and variants are sent as references with the app", async () => {
        http.post.mockResolvedValue(page([]))
        await mount({
            appId: "app-1",
            panel: {
                references: {
                    evaluator: ["ev-1"],
                    testset: ["ts-1", "ts-2"],
                    query: ["q-1"],
                    variant: ["var-1"],
                },
            },
        })
        expect(bodies()[0].run).toEqual({
            references: [
                {application: {id: "app-1"}},
                {evaluator: {id: "ev-1"}},
                {testset: {id: "ts-1"}},
                {testset: {id: "ts-2"}},
                {query: {id: "q-1"}},
                {application_variant: {id: "var-1"}},
            ],
        })
    })

    it("A date range is sent as the oldest creation time", async () => {
        http.post.mockResolvedValue(page([]))
        await mount({panel: {range: "7 days"}})
        const oldest = (bodies()[0].windowing as {oldest?: string}).oldest
        const days = (Date.now() - Date.parse(oldest ?? "")) / 86_400_000
        expect(days).toBeGreaterThan(6.9)
        expect(days).toBeLessThan(7.1)
    })

    it("The Type filter keeps runs of the picked kinds on the All tab", async () => {
        http.post.mockResolvedValue(
            page([makeRun("a"), makeRun("h", {kind: "human"}), makeRun("c", {kind: "custom"})]),
        )
        await mount({panel: {types: ["human", "custom"]}})
        expect(latest.runs.map((run) => run.id)).toEqual(["h", "c"])
    })

    it("A kind tab wins over the Type filter", async () => {
        http.post.mockResolvedValue(page([makeRun("a"), makeRun("h", {kind: "human"})]))
        await mount({kind: "auto", panel: {types: ["human"]}})
        expect(latest.runs.map((run) => run.id)).toEqual(["a"])
    })

    it("The first page request carries the search as run.name and the statuses", async () => {
        http.post.mockResolvedValue(page([makeRun("a")]))
        await mount({search: " alpha ", statuses: ["running", "queued"]})
        const [body] = bodies()
        expect(http.post.mock.calls[0][0]).toBe("https://api.test/evaluations/runs/query")
        expect(body.run).toEqual({name: "alpha", statuses: ["running", "queued"]})
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
        expect(bodies()[0].run).toEqual({references: [{application: {id: "app-1"}}]})
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
