import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post: postMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {queryEvaluationScenariosPage, queryRunLevelMetrics} from "../../src/evaluationRun"

const scenario = (id: string) => ({id, run_id: "run-1", status: "success"})

beforeEach(() => {
    postMock.mockReset()
})

describe("run details API", () => {
    it("Scenario page query sends the run id, limit, order and cursor in the body", async () => {
        postMock.mockResolvedValue({data: {scenarios: [], windowing: {}}})

        await queryEvaluationScenariosPage({
            projectId: "p1",
            runId: "run-1",
            limit: 50,
            cursor: "c-2",
            order: "descending",
        })

        expect(postMock).toHaveBeenCalledWith(
            "https://agenta.test/api/evaluations/scenarios/query",
            {
                scenario: {run_ids: ["run-1"]},
                windowing: {limit: 50, order: "descending", next: "c-2"},
            },
            {params: {project_id: "p1"}},
        )
    })

    it("Scenario page query returns the next cursor from the windowing", async () => {
        postMock.mockResolvedValueOnce({
            data: {scenarios: [scenario("s1"), scenario("s2")], windowing: {next: "c-3"}},
        })
        postMock.mockResolvedValueOnce({data: {scenarios: [scenario("s3")]}})

        const first = await queryEvaluationScenariosPage({
            projectId: "p1",
            runId: "run-1",
            limit: 2,
            order: "ascending",
        })
        const last = await queryEvaluationScenariosPage({
            projectId: "p1",
            runId: "run-1",
            limit: 2,
            cursor: first.nextCursor,
            order: "ascending",
        })

        expect(first.scenarios.map((item) => item.id)).toEqual(["s1", "s2"])
        expect(first.nextCursor).toBe("c-3")
        expect(postMock.mock.calls[0][1].windowing).toEqual({limit: 2, order: "ascending"})
        expect(last).toEqual({scenarios: [scenario("s3")], nextCursor: null})
    })

    it("Scenario page query throws when the request fails", async () => {
        postMock.mockRejectedValue(new Error("Request failed with status code 500"))

        await expect(
            queryEvaluationScenariosPage({
                projectId: "p1",
                runId: "run-1",
                limit: 10,
                order: "ascending",
            }),
        ).rejects.toThrow()
    })

    it("Run level metrics query asks for run metrics without scenarios", async () => {
        postMock.mockResolvedValue({data: {count: 0, metrics: []}})

        await queryRunLevelMetrics({projectId: "p1", runIds: ["run-1", "run-2"]})

        expect(postMock).toHaveBeenCalledWith(
            "https://agenta.test/api/evaluations/metrics/query",
            {metrics: {run_ids: ["run-1", "run-2"], scenario_ids: false}},
            {params: {project_id: "p1"}},
        )
    })
})
