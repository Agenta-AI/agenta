import {describe, expect, it} from "vitest"

import {
    resolveMappings,
    type HydratedScenarioRow,
    type RunSchema,
} from "../../src/evaluationRun/etl"

const schema: RunSchema = {
    steps: [{key: "testset-1", type: "input"}],
    mappings: [
        {
            column: {kind: "testset", name: "messages"},
            step: {key: "testset-1", path: "data.inputs.messages"},
        },
    ],
}

const rowWith = (data: unknown) =>
    ({
        scenario: {id: "scen1", status: "success", testcase_id: null},
        results: [],
        metrics: [],
        testcase: {id: "tc1", data},
        traces: {},
    }) as unknown as HydratedScenarioRow<{id: string; status: string}>

const top = [{role: "user", content: "top"}]
const nested = [{role: "user", content: "nested"}]

describe("human run messages column", () => {
    it("Reads messages from data.messages", () => {
        expect(resolveMappings(rowWith({messages: top}), schema)[0].value).toEqual(top)
    })

    it("Reads messages from data.inputs.messages", () => {
        expect(resolveMappings(rowWith({inputs: {messages: nested}}), schema)[0].value).toEqual(
            nested,
        )
    })

    it("Prefers data.messages when both exist", () => {
        const row = rowWith({messages: top, inputs: {messages: nested}})
        expect(resolveMappings(row, schema)[0].value).toEqual(top)
    })
})
