import {QueryClient} from "@tanstack/react-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock, deleteMock} = vi.hoisted(() => ({postMock: vi.fn(), deleteMock: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post: postMock, delete: deleteMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {
    deleteEvaluationRuns,
    evaluationRunsListQueryKey,
    queryEvaluationRunsPage,
    seedEvaluationRunCache,
    startOnlineEvaluation,
    stopOnlineEvaluation,
} from "../../src/evaluationRun"

interface StepSpec {
    type: "input" | "invocation" | "annotation"
    origin?: string
    app?: string
    evaluator?: string
}

const makeRun = (id: string, steps: StepSpec[] = []) => ({
    id,
    status: "success",
    data: {
        steps: steps.map((step, index) => ({
            key: `step-${index}`,
            type: step.type,
            origin: step.origin ?? "auto",
            references: {
                ...(step.app ? {application: {id: step.app}} : {}),
                ...(step.evaluator ? {evaluator: {id: step.evaluator}} : {}),
            },
        })),
    },
})

const autoRun = (id: string) => makeRun(id, [{type: "invocation", app: "app-1"}])
const humanRun = (id: string) =>
    makeRun(id, [
        {type: "invocation", app: "app-1"},
        {type: "annotation", origin: "human", evaluator: "ev-1"},
    ])

const page = (runs: unknown[], next: string | null = null) => ({
    data: {count: runs.length, runs, windowing: {next}},
})

const bodyOf = (call: number) => postMock.mock.calls[call][1]

beforeEach(() => {
    postMock.mockReset()
    deleteMock.mockReset()
})

describe("queryEvaluationRunsPage", () => {
    it("Runs page query sends the name filter as run.name, not run.search", async () => {
        postMock.mockResolvedValue(page([autoRun("r1")]))

        const result = await queryEvaluationRunsPage({
            projectId: "p1",
            limit: 15,
            name: "nightly",
            statuses: ["running"],
            createdAfter: "2026-01-01T00:00:00Z",
            createdBefore: "2026-02-01T00:00:00Z",
            cursor: "c0",
        })

        expect(postMock).toHaveBeenCalledWith(
            "https://agenta.test/api/evaluations/runs/query",
            {
                run: {name: "nightly", statuses: ["running"]},
                windowing: {
                    limit: 15,
                    order: "descending",
                    next: "c0",
                    oldest: "2026-01-01T00:00:00Z",
                    newest: "2026-02-01T00:00:00Z",
                },
            },
            {params: {project_id: "p1"}},
        )
        expect(result.runs.map((run) => run.id)).toEqual(["r1"])
    })

    it("Runs page query sends the app as an application reference and no app_id parameter", async () => {
        postMock.mockResolvedValue(page([autoRun("r1")]))

        await queryEvaluationRunsPage({projectId: "p1", limit: 15, appId: "app-1"})

        expect(bodyOf(0).run).toEqual({references: [{application: {id: "app-1"}}]})
        expect(postMock.mock.calls[0][2]).toEqual({params: {project_id: "p1"}})
    })

    it("Runs page query sends run flags as run.flags and keys the list by them", async () => {
        postMock.mockResolvedValue(page([autoRun("r1")]))

        await queryEvaluationRunsPage({
            projectId: "p1",
            limit: 15,
            flags: {has_traces: false, has_testcases: false},
        })

        expect(bodyOf(0).run).toEqual({flags: {has_traces: false, has_testcases: false}})
        expect(evaluationRunsListQueryKey("p1", {flags: {has_traces: false}})).not.toEqual(
            evaluationRunsListQueryKey("p1"),
        )
    })

    it("Runs page query omits run when no filter is set", async () => {
        postMock.mockResolvedValue(page([], "next-1"))

        const result = await queryEvaluationRunsPage({projectId: "p1", limit: 15})

        expect(bodyOf(0)).toEqual({windowing: {limit: 15, order: "descending"}})
        expect(result).toEqual({runs: [], nextCursor: "next-1"})
    })

    it("Kind filter reads more server pages until the page is full", async () => {
        postMock
            .mockResolvedValueOnce(page([autoRun("a1"), autoRun("a2")], "c1"))
            .mockResolvedValueOnce(page([humanRun("h1"), humanRun("h2"), humanRun("h3")], "c2"))

        const result = await queryEvaluationRunsPage({
            projectId: "p1",
            limit: 2,
            kind: "human",
        })

        expect(postMock).toHaveBeenCalledTimes(2)
        expect(bodyOf(0).windowing).toEqual({limit: 25, order: "descending"})
        expect(bodyOf(1).windowing).toEqual({limit: 25, order: "descending", next: "c1"})
        expect(result.runs.map((run) => run.id)).toEqual(["h1", "h2"])
        // h3 was read but not returned, so the next page starts after h2.
        expect(result.nextCursor).toBe("h2")
    })

    it("Kind filter keeps the server cursor when the page ends on the last match", async () => {
        postMock.mockResolvedValueOnce(page([autoRun("a1"), humanRun("h1")], "c1"))

        const result = await queryEvaluationRunsPage({projectId: "p1", limit: 1, kind: "human"})

        expect(result).toMatchObject({nextCursor: "c1"})
    })

    it("Kind filter stops after eight server pages and returns the last cursor", async () => {
        postMock.mockImplementation(async () => {
            const call = postMock.mock.calls.length
            return page([autoRun(`a${call}`)], `c${call}`)
        })

        const result = await queryEvaluationRunsPage({projectId: "p1", limit: 5, kind: "human"})

        expect(postMock).toHaveBeenCalledTimes(8)
        expect(result).toEqual({runs: [], nextCursor: "c8"})
    })

    it("Kind filter returns no cursor when the runs end", async () => {
        postMock.mockResolvedValueOnce(page([humanRun("h1")], null))

        const result = await queryEvaluationRunsPage({projectId: "p1", limit: 5, kind: "human"})

        expect(postMock).toHaveBeenCalledTimes(1)
        expect(result.nextCursor).toBeNull()
    })

    it("Feeding each returned cursor into the next call skips and repeats no run", async () => {
        const server = [
            humanRun("h1"),
            autoRun("a1"),
            humanRun("h2"),
            humanRun("h3"),
            autoRun("a2"),
            humanRun("h4"),
            humanRun("h5"),
        ]
        // Fake server: a cursor is the id of the last row already read (`id < next`).
        postMock.mockImplementation(
            async (_url: string, body: {windowing: Record<string, unknown>}) => {
                const {limit, next} = body.windowing as {limit: number; next?: string}
                const start = next ? server.findIndex((run) => run.id === next) + 1 : 0
                const rows = server.slice(start, start + limit)
                const more = start + limit < server.length
                return page(rows, more ? rows[rows.length - 1].id : null)
            },
        )

        const seen: string[] = []
        let cursor: string | null = null
        for (let guard = 0; guard < 10; guard++) {
            const result = await queryEvaluationRunsPage({
                projectId: "p1",
                limit: 2,
                kind: "human",
                cursor,
            })
            seen.push(...result.runs.map((run) => run.id))
            cursor = result.nextCursor
            if (!cursor) break
        }

        expect(seen).toEqual(["h1", "h2", "h3", "h4", "h5"])
    })

    it("Feeding the cursor of an unfiltered page into the next call continues the list", async () => {
        postMock
            .mockResolvedValueOnce(page([autoRun("a1"), autoRun("a2")], "a2"))
            .mockResolvedValueOnce(page([autoRun("a3")], null))

        const first = await queryEvaluationRunsPage({projectId: "p1", limit: 2})
        const second = await queryEvaluationRunsPage({
            projectId: "p1",
            limit: 2,
            cursor: first.nextCursor,
        })

        expect(bodyOf(1).windowing).toEqual({limit: 2, order: "descending", next: "a2"})
        expect([...first.runs, ...second.runs].map((run) => run.id)).toEqual(["a1", "a2", "a3"])
        expect(second.nextCursor).toBeNull()
    })

    it("App scope drops runs where the app is only an evaluator", async () => {
        const graderRun = makeRun("g1", [
            {type: "invocation", app: "other-app"},
            {type: "annotation", origin: "auto", evaluator: "app-1"},
        ])
        const unclassified = makeRun("u1", [])
        postMock.mockResolvedValueOnce(page([graderRun, autoRun("s1"), unclassified], null))

        const result = await queryEvaluationRunsPage({projectId: "p1", limit: 10, appId: "app-1"})

        expect(result.runs.map((run) => run.id)).toEqual(["s1", "u1"])
    })

    it("Runs page query throws when the request fails", async () => {
        postMock.mockImplementation(async () => {
            throw new Error("network down")
        })

        await expect(queryEvaluationRunsPage({projectId: "p1", limit: 15})).rejects.toThrow(
            "network down",
        )
    })

    it("Runs page query throws when the response has the wrong shape", async () => {
        postMock.mockResolvedValue({data: {runs: "none"}})

        await expect(queryEvaluationRunsPage({projectId: "p1", limit: 15})).rejects.toThrow()
    })
})

describe("run actions", () => {
    it("Delete runs sends DELETE with the run ids in the body", async () => {
        deleteMock.mockResolvedValue({data: {count: 2, run_ids: ["r1", "r2"]}})

        await deleteEvaluationRuns({projectId: "p1", runIds: ["r1", "r2"]})

        expect(deleteMock).toHaveBeenCalledWith("https://agenta.test/api/evaluations/runs/", {
            params: {project_id: "p1"},
            data: {run_ids: ["r1", "r2"]},
        })
    })

    it("Delete runs sends nothing for an empty list", async () => {
        await deleteEvaluationRuns({projectId: "p1", runIds: []})

        expect(deleteMock).not.toHaveBeenCalled()
    })

    it("Delete runs passes when the API lists every requested run as deleted", async () => {
        deleteMock.mockResolvedValue({data: {count: 2, run_ids: ["r1", "r2"]}})

        await expect(
            deleteEvaluationRuns({projectId: "p1", runIds: ["r1", "r2"]}),
        ).resolves.toBeUndefined()
    })

    it("Delete runs passes on a retry when the API returns an empty run_ids list", async () => {
        deleteMock.mockResolvedValue({data: {count: 0, run_ids: []}})

        await expect(
            deleteEvaluationRuns({projectId: "p1", runIds: ["r1", "r2"]}),
        ).resolves.toBeUndefined()
    })

    it("Delete runs throws when the response has no run_ids", async () => {
        deleteMock.mockResolvedValue({data: {count: 2}})

        await expect(deleteEvaluationRuns({projectId: "p1", runIds: ["r1", "r2"]})).rejects.toThrow(
            "The runs were not deleted.",
        )
    })

    it("Delete runs throws when a 200 response has an unexpected body", async () => {
        deleteMock.mockResolvedValue({data: "<html>proxy page</html>"})

        await expect(deleteEvaluationRuns({projectId: "p1", runIds: ["r1"]})).rejects.toThrow(
            "The runs were not deleted.",
        )
    })

    it("Stop and start call the simple evaluation stop and start paths", async () => {
        postMock.mockResolvedValue({data: {count: 1, evaluation: {id: "r1"}}})

        await stopOnlineEvaluation({projectId: "p1", runId: "r1"})
        await startOnlineEvaluation({projectId: "p1", runId: "r1"})

        expect(postMock.mock.calls.map((call) => [call[0], call[2]])).toEqual([
            ["https://agenta.test/api/simple/evaluations/r1/stop", {params: {project_id: "p1"}}],
            ["https://agenta.test/api/simple/evaluations/r1/start", {params: {project_id: "p1"}}],
        ])
    })

    it("Stop and start throw when a 200 response has no evaluation", async () => {
        postMock.mockResolvedValue({data: {count: 0, evaluation: null}})

        await expect(stopOnlineEvaluation({projectId: "p1", runId: "r1"})).rejects.toThrow(
            "The evaluation did not stop.",
        )
        await expect(startOnlineEvaluation({projectId: "p1", runId: "r1"})).rejects.toThrow(
            "The evaluation did not start.",
        )
    })

    it("Stop and start throw when a 200 response has an unexpected body", async () => {
        postMock.mockResolvedValue({data: {}})

        await expect(stopOnlineEvaluation({projectId: "p1", runId: "r1"})).rejects.toThrow(
            "The evaluation did not stop.",
        )
        await expect(startOnlineEvaluation({projectId: "p1", runId: "r1"})).rejects.toThrow(
            "The evaluation did not start.",
        )
    })
})

describe("list cache helpers", () => {
    it("Seeding the run cache fills evaluationRun queries for each listed run", () => {
        const queryClient = new QueryClient()
        const runs = [autoRun("r1"), autoRun("r2")] as Parameters<typeof seedEvaluationRunCache>[1]

        seedEvaluationRunCache(queryClient, runs)

        expect(queryClient.getQueryData(["evaluationRun", "r1"])).toEqual(runs[0])
        expect(queryClient.getQueryData(["evaluationRun", "r2"])).toEqual(runs[1])
    })

    it("Seeding the run cache keeps a run cached in the last minute", () => {
        const queryClient = new QueryClient()
        const fresh = {...autoRun("r1"), name: "fresh"}
        queryClient.setQueryData(["evaluationRun", "r1"], fresh)

        seedEvaluationRunCache(queryClient, [autoRun("r1")] as Parameters<
            typeof seedEvaluationRunCache
        >[1])

        expect(queryClient.getQueryData(["evaluationRun", "r1"])).toBe(fresh)
    })

    it("The list query key ignores the order of the statuses", () => {
        expect(evaluationRunsListQueryKey("p1", {statuses: ["running", "queued"]})).toEqual(
            evaluationRunsListQueryKey("p1", {statuses: ["queued", "running"]}),
        )
    })
})
