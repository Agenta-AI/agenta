import {describe, expect, it} from "vitest"

import {
    buildScenarioRowData,
    groupFallbackLabel,
    isTerminalScenarioStatus,
    scenarioColumnGroups,
    scoreText,
    type ScenarioSchema,
} from "@/features/evaluation-run/scenarios/scenarioColumns"

const schema: ScenarioSchema = {
    steps: [
        {key: "ts", type: "input", references: {testset: {id: "t1", slug: "capitals"}}},
        {key: "app", type: "invocation", references: {application: {id: "a1", slug: "geo-bot"}}},
    ],
    mappings: [
        {column: {kind: "testset", name: "country"}, step: {key: "ts", path: "data.country"}},
        {column: {kind: "testset", name: "testcase_dedup_id"}, step: {key: "ts", path: "id"}},
        {
            column: {kind: "invocation", name: "answer"},
            step: {key: "app", path: "attributes.ag.data.outputs"},
        },
        {
            column: {kind: "invocation", name: "cost"},
            step: {key: "app", path: "attributes.ag.metrics.costs.cumulative.total"},
        },
        {column: null, step: {key: "app", path: "x"}},
    ],
}

describe("scenario columns", () => {
    it("Groups follow the run steps and name a test set without a name from its slug", () => {
        const groups = scenarioColumnGroups(schema)
        expect(groups.map((entry) => entry.group.key)).toEqual([
            "testset:capitals",
            "application:geo-bot",
            "metrics",
        ])
        expect(groupFallbackLabel(groups[0].group)).toBe("Test set capitals")
        expect(groupFallbackLabel(groups[1].group)).toBe("Application geo-bot")
    })

    it("Rows carry application outputs and metrics from the trace, and leave out internal columns", () => {
        const trace = {
            spans: {
                root: {
                    attributes: {
                        ag: {
                            data: {outputs: "Paris"},
                            metrics: {costs: {cumulative: {total: 0.002}}},
                        },
                    },
                },
            },
        }
        const row = buildScenarioRowData(
            {
                scenario: {id: "sc-1", run_id: "r", status: "success"},
                results: [{run_id: "r", scenario_id: "sc-1", step_key: "app", trace_id: "t-1"}],
                metrics: [],
                testcase: {id: "tc", data: {country: "France"}} as never,
                traces: {"t-1": trace},
            },
            schema,
        )
        expect(row.cells["testset:capitals"]).toMatchObject([{name: "country", value: "France"}])
        expect(row.cells["application:geo-bot"]).toMatchObject([{name: "answer", value: "Paris"}])
        expect(row.cells["metrics"]).toMatchObject([{name: "cost", value: 0.002}])
    })

    // The shape of a live run, as the API creates it (captured on a dev stack, 2026-11-05).
    const liveSchema: ScenarioSchema = {
        steps: [
            {key: "query-f416", type: "input", references: {query: {id: "q1", slug: "qa-live"}}},
            {
                key: "evaluator-fcda",
                type: "annotation",
                references: {evaluator: {id: "e1", slug: "starts-uppercase"}},
            },
        ],
        mappings: [
            {
                column: {kind: "query", name: "data"},
                step: {key: "query-f416", path: "attributes.ag.data"},
            },
            {
                column: {kind: "annotation", name: "success"},
                step: {key: "evaluator-fcda", path: "attributes.ag.data.outputs.success"},
            },
        ],
    }
    const liveTrace = {
        spans: {capital: {attributes: {ag: {data: {inputs: {country: "Peru"}, outputs: "Lima"}}}}},
    }

    it("A live run shows the inputs and outputs of the trace it read, not a test set", () => {
        const groups = scenarioColumnGroups(liveSchema)
        expect(groups.map(({group}) => [group.kind, groupFallbackLabel(group)])).toEqual([
            ["testset", "Inputs"],
            ["application", "Outputs"],
            ["evaluator", "Starts Uppercase"],
        ])

        const row = buildScenarioRowData(
            {
                scenario: {id: "sc-1", run_id: "r", status: "success"},
                results: [
                    {
                        run_id: "r",
                        scenario_id: "sc-1",
                        step_key: "query-f416",
                        trace_id: "t-1",
                        status: "success",
                    },
                ],
                metrics: [],
                testcase: null,
                traces: {"t-1": liveTrace},
            },
            liveSchema,
        )
        expect(row.cells[groups[0].group.key]).toMatchObject([
            {name: "inputs", value: {country: "Peru"}},
        ])
        expect(row.cells[groups[1].group.key]).toMatchObject([{name: "outputs", value: "Lima"}])
        // "Open trace" opens the trace the run read.
        expect(row.invocation).toEqual({traceId: "t-1", status: "success"})
    })

    it("A failed step carries its error message under its group", () => {
        const row = buildScenarioRowData(
            {
                scenario: {id: "sc-1", run_id: "r", status: "errors"},
                results: [
                    {
                        run_id: "r",
                        scenario_id: "sc-1",
                        step_key: "query-f416",
                        trace_id: "t-1",
                        status: "success",
                    },
                    {
                        run_id: "r",
                        scenario_id: "sc-1",
                        step_key: "evaluator-fcda",
                        trace_id: "t-2",
                        status: "failure",
                        error: {code: 400, message: "Invalid regex pattern: '([A-Z'."},
                    },
                ],
                metrics: [],
                testcase: null,
                traces: {"t-1": liveTrace},
            },
            liveSchema,
        )
        expect(row.errors).toEqual({
            "evaluator:starts-uppercase": "Invalid regex pattern: '([A-Z'.",
        })
    })

    it("A scenario is finished once it succeeded or failed", () => {
        expect(["success", "FAILURE", "cancelled"].every(isTerminalScenarioStatus)).toBe(true)
        expect(["running", "pending", null, undefined].some(isTerminalScenarioStatus)).toBe(false)
    })

    it("A score reads as a short text", () => {
        expect(scoreText(true)).toBe("true")
        expect(scoreText(0.8333)).toBe("0.833")
        expect(
            scoreText({
                type: "binary",
                freq: [
                    {value: false, count: 1},
                    {value: true, count: 3},
                ],
            }),
        ).toBe("true")
        expect(scoreText({type: "numeric/continuous", mean: 0.5})).toBe("0.5")
        expect(scoreText(null)).toBeNull()
        expect(scoreText({type: "string", count: 2})).toBeNull()
    })
})
