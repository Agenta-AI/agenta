import {describe, expect, it} from "vitest"

import {scenarioPayload, valuesByName} from "@/features/evaluation-run/focus/scenarioPayload"
import type {ScenarioRow} from "@/features/evaluation-run/scenarios/scenarioColumns"

describe("scenarioPayload", () => {
    it("keeps both outputs when two apps write the same name", () => {
        expect(
            valuesByName([
                ["outputs", "a"],
                ["outputs", "b"],
                ["outputs", "c"],
            ]),
        ).toEqual({outputs: "a", "outputs 2": "b", "outputs 3": "c"})
    })

    it("keeps a multiple choice a list, also with one label", () => {
        const row = {
            cells: {
                one: [
                    {
                        name: "tags",
                        value: {
                            type: "categorical/multiple",
                            count: 1,
                            freq: [{value: "billing", count: 1}],
                        },
                    },
                    {
                        name: "topic",
                        value: {
                            type: "categorical/single",
                            count: 1,
                            freq: [{value: "refund", count: 1}],
                        },
                    },
                ],
            },
            errors: {},
        } as unknown as ScenarioRow
        const groups = [{group: {key: "one", kind: "evaluator", label: "Classifier"}}] as never
        expect(scenarioPayload(row, groups, {}).evaluators).toEqual({
            Classifier: {tags: ["billing"], topic: "refund"},
        })
    })
})
