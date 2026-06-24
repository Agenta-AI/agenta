import assert from "node:assert/strict"
import {describe, it} from "vitest"

import {
    adaptInputSourceMappings,
    getInputSourceAdapter,
    normalizeInputSourceValue,
} from "../../src/etl/inputSourceAdapter"

describe("inputSourceAdapter", () => {
    it("identifies query-backed inputs as trace-backed", () => {
        const adapter = getInputSourceAdapter({
            key: "query-source",
            type: "input",
            references: {query_revision: {id: "query-revision-1"}},
        })

        assert.equal(adapter?.kind, "query")
        assert.equal(adapter?.storage, "trace")
    })

    it("identifies testset-backed inputs as testcase-backed", () => {
        const adapter = getInputSourceAdapter({
            key: "testset-source",
            type: "input",
            references: {testset_revision: {id: "testset-revision-1"}},
        })

        assert.equal(adapter?.kind, "testset")
        assert.equal(adapter?.storage, "testcase")
    })

    it("expands the backend query data mapping into inputs and outputs", () => {
        const mappings = adaptInputSourceMappings(
            [
                {
                    key: "query-source",
                    type: "input",
                    references: {query_revision: {id: "query-revision-1"}},
                },
            ],
            [
                {
                    column: {kind: "query", name: "data"},
                    step: {key: "query-source", path: "attributes.ag.data"},
                },
            ],
        )

        assert.deepEqual(mappings, [
            {
                column: {kind: "query", name: "inputs"},
                step: {key: "query-source", path: "attributes.ag.data.inputs"},
            },
            {
                column: {kind: "query", name: "outputs"},
                step: {key: "query-source", path: "attributes.ag.data.outputs"},
            },
        ])
    })

    it("unwraps the repeated inputs envelope from query traces", () => {
        const value = normalizeInputSourceValue(
            {
                key: "query-source",
                type: "input",
                references: {query_revision: {id: "query-revision-1"}},
            },
            {
                column: {kind: "query", name: "inputs"},
                step: {key: "query-source", path: "attributes.ag.data.inputs"},
            },
            {inputs: {country: "Kiribati"}},
        )

        assert.deepEqual(value, {country: "Kiribati"})
    })
})
