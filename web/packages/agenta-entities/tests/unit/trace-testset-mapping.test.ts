import {beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({post: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        axios: {...actual.axios, post: http.post},
    }
})

import {fetchRevisionColumnKeys} from "../../src/testset/api"
import {
    buildTestsetRowsFromTraces,
    findDuplicateMappingColumns,
    getTraceMappingPathOptions,
    hasDifferentStructure,
    newColumnsOf,
    suggestTraceMappings,
} from "../../src/trace"

const completion = (country: string, answer: string) => ({
    inputs: {country},
    outputs: answer,
})

const chat = (topic: string) => ({
    inputs: {topic, messages: [{role: "user", content: `Tell me about ${topic}`}]},
    outputs: {role: "assistant", content: "Sure."},
})

describe("trace to test set mapping", () => {
    it("Completion spans map data.inputs and data.outputs to inputs and outputs columns", () => {
        const suggested = suggestTraceMappings({
            spansData: [completion("France", "Paris"), completion("Spain", "Madrid")],
            existingColumns: [],
        })
        expect(suggested).toEqual([
            {path: "data.inputs", column: "inputs", isNew: true},
            {path: "data.outputs", column: "outputs", isNew: true},
        ])
    })

    it("Chat spans split the message history from the variable inputs", () => {
        const suggested = suggestTraceMappings({spansData: [chat("tides")], existingColumns: []})
        expect(suggested.map(({path, column}) => [path, column])).toEqual([
            ["data.inputs.topic", "topic"],
            ["data.inputs.messages", "messages"],
            ["data.outputs", "outputs"],
        ])
    })

    it("Suggestions reuse an existing column with the same name", () => {
        const suggested = suggestTraceMappings({
            spansData: [completion("France", "Paris")],
            existingColumns: ["Inputs", "expected"],
        })
        expect(suggested).toEqual([
            {path: "data.inputs", column: "Inputs", isNew: false},
            {path: "data.outputs", column: "outputs", isNew: true},
        ])
    })

    it("Suggestions read only the first 50 spans", () => {
        const spansData = [
            ...Array.from({length: 50}, () => completion("France", "Paris")),
            {inputs: {country: "Peru"}, outputs: "Lima", extra: "late"},
        ]
        const paths = getTraceMappingPathOptions(spansData)
        expect(paths).not.toContain("data.extra")
        expect(paths).toEqual(["data.inputs", "data.inputs.country", "data.outputs"])
    })

    it("Rows set an empty string for a missing value and keep objects as objects", () => {
        const rows = buildTestsetRowsFromTraces({
            spansData: [chat("tides"), {inputs: {}, outputs: null}],
            mappings: [
                {path: "data.inputs.topic", column: "topic"},
                {path: "data.outputs", column: "answer"},
                // Incomplete rows add nothing.
                {path: "", column: "ignored"},
                {path: "data.inputs", column: ""},
            ],
        })
        expect(rows).toEqual([
            {topic: "tides", answer: {role: "assistant", content: "Sure."}},
            {topic: "", answer: ""},
        ])
    })

    it("Duplicate target columns are reported", () => {
        expect(
            findDuplicateMappingColumns([
                {path: "data.inputs", column: "inputs"},
                {path: "data.outputs", column: "answer"},
                {path: "data.inputs.country", column: " inputs "},
                {path: "data.outputs", column: ""},
                {path: "", column: ""},
            ]),
        ).toEqual(["inputs"])
    })

    it("New columns are the mapped columns the test set does not have yet", () => {
        expect(
            newColumnsOf(
                [
                    {path: "data.inputs", column: "inputs"},
                    {path: "data.outputs", column: "answer"},
                    {path: "", column: "draft"},
                ],
                ["inputs"],
            ),
        ).toEqual(["answer"])
    })

    it("Spans with different keys report a different structure", () => {
        expect(hasDifferentStructure([completion("France", "Paris")])).toBe(false)
        expect(
            hasDifferentStructure([completion("France", "Paris"), completion("Spain", "Madrid")]),
        ).toBe(false)
        expect(hasDifferentStructure([completion("France", "Paris"), chat("tides")])).toBe(true)
    })
})

describe("fetchRevisionColumnKeys", () => {
    beforeEach(() => http.post.mockReset())

    const revision = (data: Record<string, unknown>) => ({
        data: {
            testset_revisions: [
                {id: "rev-2", testset_id: "ts-1", version: 2, data, created_at: "2026-01-01"},
            ],
        },
    })

    it("Revision column keys read every row and fail when rows are missing", async () => {
        http.post.mockResolvedValueOnce(
            revision({
                testcase_ids: ["tc-1", "tc-2"],
                testcases: [
                    {id: "tc-1", data: {question: "a", context: {source: "x"}}},
                    {id: "tc-2", data: {question: "b", expected: "c"}},
                ],
            }),
        )
        await expect(
            fetchRevisionColumnKeys({projectId: "project-1", revisionId: "rev-2"}),
        ).resolves.toEqual({keys: ["question", "context", "expected"], hasRows: true})
        expect(http.post).toHaveBeenCalledWith(
            "http://api.test/testsets/revisions/query",
            {testset_revision_refs: [{id: "rev-2"}], windowing: {limit: 1}},
            {params: {project_id: "project-1", include_testcases: true}},
        )

        http.post.mockResolvedValueOnce(
            revision({
                testcase_ids: ["tc-1", "tc-2"],
                testcases: [{id: "tc-1", data: {question: "a"}}],
            }),
        )
        await expect(
            fetchRevisionColumnKeys({projectId: "project-1", revisionId: "rev-2"}),
        ).rejects.toThrow("did not return all its testcases")
    })

    it("A revision with no rows has no columns", async () => {
        http.post.mockResolvedValueOnce(revision({testcase_ids: [], testcases: []}))
        await expect(
            fetchRevisionColumnKeys({projectId: "project-1", revisionId: "rev-2"}),
        ).resolves.toEqual({keys: [], hasRows: false})
    })
})
