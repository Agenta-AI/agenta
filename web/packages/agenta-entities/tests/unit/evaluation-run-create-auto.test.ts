import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post: postMock, delete: vi.fn()},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {createAutoEvaluationRuns, DEFAULT_EVALUATION_CONCURRENCY} from "../../src/evaluationRun"

const created = (id: string) => ({data: {evaluation: {id}}})

const base = {
    projectId: "p1",
    name: "Nightly check",
    testsetRevisionId: "ts-rev",
    applicationRevisionIds: ["app-rev-1", "app-rev-2"],
    evaluatorRevisionIds: ["ev-rev-1", "ev-rev-2"],
}

beforeEach(() => postMock.mockReset())

describe("createAutoEvaluationRuns", () => {
    it("Auto create posts one simple evaluation per revision with the same name", async () => {
        postMock.mockResolvedValueOnce(created("run-1")).mockResolvedValueOnce(created("run-2"))

        const result = await createAutoEvaluationRuns(base)

        expect(postMock).toHaveBeenCalledTimes(2)
        const bodies = postMock.mock.calls.map((call) => call[1].evaluation)
        expect(bodies.map((body) => body.name)).toEqual(["Nightly check", "Nightly check"])
        expect(bodies.map((body) => body.data.application_steps)).toEqual([
            {"app-rev-1": "auto"},
            {"app-rev-2": "auto"},
        ])
        expect(postMock.mock.calls[0][0]).toBe("https://agenta.test/api/simple/evaluations/")
        expect(postMock.mock.calls[0][2]).toEqual({params: {project_id: "p1"}})
        expect(result).toEqual({runIds: ["run-1", "run-2"], failedRevisionIds: []})
    })

    it("Auto create sends testset, application and evaluator steps as auto and the concurrency settings", async () => {
        postMock.mockResolvedValue(created("run-1"))

        await createAutoEvaluationRuns({
            ...base,
            applicationRevisionIds: ["app-rev-1"],
            concurrency: {batch_size: 4, max_retries: 1, retry_delay: 2},
        })

        expect(postMock.mock.calls[0][1]).toEqual({
            evaluation: {
                name: "Nightly check",
                data: {
                    testset_steps: {"ts-rev": "auto"},
                    application_steps: {"app-rev-1": "auto"},
                    evaluator_steps: {"ev-rev-1": "auto", "ev-rev-2": "auto"},
                    concurrency: {batch_size: 4, max_retries: 1, retry_delay: 2},
                },
                flags: {is_live: false, is_active: true, is_closed: false},
            },
        })
    })

    it("Auto create uses the default concurrency when none is given", async () => {
        postMock.mockResolvedValue(created("run-1"))

        await createAutoEvaluationRuns({...base, applicationRevisionIds: ["app-rev-1"]})

        expect(postMock.mock.calls[0][1].evaluation.data.concurrency).toEqual(
            DEFAULT_EVALUATION_CONCURRENCY,
        )
    })

    it("Auto create reports created run ids and failed revisions when one request fails", async () => {
        postMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(created("run-2"))

        const result = await createAutoEvaluationRuns(base)

        expect(result).toEqual({runIds: ["run-2"], failedRevisionIds: ["app-rev-1"]})
    })

    it("Auto create throws when every request fails", async () => {
        postMock.mockRejectedValueOnce(new Error("boom")).mockRejectedValueOnce(new Error("boom"))

        await expect(createAutoEvaluationRuns(base)).rejects.toThrow("boom")
    })

    it("Auto create throws when no app revision is selected", async () => {
        await expect(
            createAutoEvaluationRuns({...base, applicationRevisionIds: []}),
        ).rejects.toThrow()
        expect(postMock).not.toHaveBeenCalled()
    })
})
