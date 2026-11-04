import {beforeEach, describe, expect, it, vi} from "vitest"

// The live create goes through the generated API clients: they are the HTTP seam here. Each
// client method records its call under its endpoint path and answers like the API body.
const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => {
    const endpoint =
        (path: (body: {query_id?: string}) => string) =>
        async (body: {query_id?: string}, options: unknown) =>
            (await postMock(`https://agenta.test/api${path(body)}`, body, options)).data
    return {
        getQueriesClient: () => ({
            createSimpleQuery: endpoint(() => "/simple/queries/"),
            retrieveQueryRevision: endpoint(() => "/queries/revisions/retrieve"),
            archiveSimpleQuery: endpoint((body) => `/simple/queries/${body.query_id}/archive`),
        }),
        getEvaluationsClient: () => ({
            createSimpleEvaluation: endpoint(() => "/simple/evaluations/"),
        }),
    }
})

import {
    buildQuerySlug,
    createLiveEvaluation,
    LIVE_INVOCATION_FILTER,
    parseSamplingRate,
    selectLiveEvaluators,
} from "../../src/evaluationRun"

const API = "https://agenta.test/api"
const PARAMS = {queryParams: {project_id: "p1"}}

const base = {
    projectId: "p1",
    name: "Support replies",
    description: "Checks tone",
    filters: [LIVE_INVOCATION_FILTER],
    samplingRate: 100,
    evaluatorRevisionId: "ev-rev-1",
    slugSuffix: "a1b2c3d4",
}

const answers = () =>
    postMock
        .mockResolvedValueOnce({data: {count: 1, query: {id: "q-1"}}})
        .mockResolvedValueOnce({data: {count: 1, query_revision: {id: "q-rev-1"}}})
        .mockResolvedValueOnce({data: {count: 1, evaluation: {id: "run-1"}}})

beforeEach(() => postMock.mockReset())

describe("createLiveEvaluation", () => {
    it("Live create posts the query, reads its revision, then posts a live evaluation with that revision", async () => {
        answers()

        const result = await createLiveEvaluation(base)

        expect(result).toEqual({runId: "run-1"})
        expect(postMock.mock.calls).toEqual([
            [
                `${API}/simple/queries/`,
                {
                    query: {
                        slug: "support-replies-a1b2c3d4",
                        name: "Support replies",
                        description: "Checks tone",
                        data: {
                            filtering: {
                                operator: "and",
                                conditions: [
                                    {field: "trace_type", operator: "is", value: "invocation"},
                                ],
                            },
                            windowing: {rate: 1},
                        },
                    },
                },
                PARAMS,
            ],
            [`${API}/queries/revisions/retrieve`, {query_ref: {id: "q-1"}}, PARAMS],
            [
                `${API}/simple/evaluations/`,
                {
                    evaluation: {
                        name: "Support replies",
                        description: "Checks tone",
                        flags: {is_live: true, is_closed: false, is_active: false},
                        data: {
                            status: "pending",
                            query_steps: {"q-rev-1": "auto"},
                            evaluator_steps: {"ev-rev-1": "auto"},
                            repeats: 1,
                        },
                    },
                },
                PARAMS,
            ],
        ])
    })

    it("Sampling rate 25 becomes windowing rate 0.25", async () => {
        answers()

        await createLiveEvaluation({...base, filters: [], samplingRate: 25})

        expect(postMock.mock.calls[0][1].query.data).toEqual({windowing: {rate: 0.25}})
    })

    it("No filter rows and no rate send the query without data", async () => {
        answers()

        await createLiveEvaluation({...base, description: "", filters: [], samplingRate: null})

        expect(postMock.mock.calls[0][1]).toEqual({
            query: {slug: "support-replies-a1b2c3d4", name: "Support replies", description: ""},
        })
    })

    it("A references row is sent without a key, and an empty operator becomes is", async () => {
        answers()

        await createLiveEvaluation({
            ...base,
            samplingRate: null,
            filters: [
                {
                    field: "references",
                    key: "application",
                    operator: "in",
                    value: [{id: "app-1", "attributes.key": "application"}],
                },
                {field: "attributes", key: "ag.meta.user", operator: "", value: "Sam Lee"},
            ],
        })

        expect(postMock.mock.calls[0][1].query.data.filtering).toEqual({
            operator: "and",
            conditions: [
                {
                    field: "references",
                    operator: "in",
                    value: [{id: "app-1", "attributes.key": "application"}],
                },
                {field: "attributes", key: "ag.meta.user", operator: "is", value: "Sam Lee"},
            ],
        })
    })

    it("A failed evaluation request archives the query and throws", async () => {
        const failure = new Error("boom")
        postMock
            .mockResolvedValueOnce({data: {query: {id: "q-1"}}})
            .mockResolvedValueOnce({data: {query_revision: {id: "q-rev-1"}}})
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce({data: {}})

        await expect(createLiveEvaluation(base)).rejects.toBe(failure)

        expect(postMock).toHaveBeenCalledTimes(4)
        expect(postMock.mock.calls[3]).toEqual([
            `${API}/simple/queries/q-1/archive`,
            {query_id: "q-1"},
            PARAMS,
        ])
    })

    it("A revision answer without an id archives the query and throws", async () => {
        postMock
            .mockResolvedValueOnce({data: {query: {id: "q-1"}}})
            .mockResolvedValueOnce({data: {query_revision: null}})
            .mockRejectedValueOnce(new Error("archive failed"))

        await expect(createLiveEvaluation(base)).rejects.toThrow("query revision")

        expect(postMock.mock.calls.map((call) => call[0])).toEqual([
            `${API}/simple/queries/`,
            `${API}/queries/revisions/retrieve`,
            `${API}/simple/queries/q-1/archive`,
        ])
    })

    it("A query answer without an id throws and archives nothing", async () => {
        postMock.mockResolvedValueOnce({data: {query: null}})

        await expect(createLiveEvaluation(base)).rejects.toThrow("query id")
        expect(postMock).toHaveBeenCalledTimes(1)
    })
})

describe("live query helpers", () => {
    it("The query slug is the slugged name with the suffix, or online-evaluation", () => {
        expect(buildQuerySlug("  Support Replies (EU)! ", "a1b2c3d4")).toBe(
            "support-replies-eu-a1b2c3d4",
        )
        expect(buildQuerySlug("!!!", "a1b2c3d4")).toBe("online-evaluation-a1b2c3d4")
    })

    it("Sampling rate input is rounded and kept between 0 and 100, empty means none", () => {
        expect(parseSamplingRate("")).toBeNull()
        expect(parseSamplingRate(null)).toBeNull()
        expect(parseSamplingRate("abc")).toBeNull()
        expect(parseSamplingRate("24.6")).toBe(25)
        expect(parseSamplingRate(140)).toBe(100)
        expect(parseSamplingRate(-3)).toBe(0)
    })

    it("Only online capable, non-human evaluators can run live", () => {
        const llm = {id: "r1", name: "Judge", flags: {is_llm: true}}
        const human = {id: "r2", name: "Reviewer", flags: {is_feedback: true, is_custom: true}}
        const exactMatch = {
            id: "r3",
            name: "Exact",
            flags: {},
            data: {uri: "agenta:builtin:auto_exact_match:v0"},
        }
        const regex = {
            id: "r4",
            name: "Regex",
            flags: {},
            data: {uri: "agenta:builtin:auto_regex_test:v0"},
        }

        expect(selectLiveEvaluators([llm, human, exactMatch, regex]).map((e) => e.id)).toEqual([
            "r1",
            "r4",
        ])
    })
})
