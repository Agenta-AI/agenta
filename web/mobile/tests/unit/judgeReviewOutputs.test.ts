import {computeColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {describe, expect, it} from "vitest"

import type {ScenarioEvaluatorResult} from "@/features/evaluation-run/focus/ScenarioFocusResultsTab"
import {
    scalarLeaves,
    scenarioJudges,
    setAtPath,
} from "@/features/evaluation-run/focus/useJudgeReviews"
import type {ScenarioRow} from "@/features/evaluation-run/scenarios/scenarioColumns"

describe("judge review outputs", () => {
    it("A judge's outputs follow the mapping paths, nested ones included", () => {
        const step = {key: "app.judge", type: "annotation", references: {evaluator: {id: "ev"}}}
        const key = computeColumnGroup(step as never, "").key
        const row = {
            cells: {
                [key]: [
                    {name: "judge.success", value: false},
                    {name: "judge.quality.score", value: 0.2},
                ],
            },
        } as unknown as ScenarioRow
        const result = {
            id: key,
            name: "Judge",
            summary: {failed: true},
            step: {traceId: "t", spanId: "s", metrics: {}},
        } as unknown as ScenarioEvaluatorResult
        const [judge] = scenarioJudges(
            row,
            [{group: {kind: "evaluator", key: key, refs: step.references}}] as never,
            [result],
            {
                steps: [step] as never,
                mappings: [
                    {
                        column: {kind: "evaluator", name: "judge.success"},
                        step: {key: "app.judge", path: "attributes.ag.data.outputs.success"},
                    },
                    {
                        column: {kind: "evaluator", name: "judge.quality.score"},
                        step: {key: "app.judge", path: "attributes.ag.data.outputs.quality.score"},
                    },
                ] as never,
            },
        )
        expect(judge.outputs).toEqual({success: false, quality: {score: 0.2}})
        expect(judge.reviewable).toBe(true)
    })

    it("Judges come in the Results tab's order: failed first by name, then the others", () => {
        const result = (id: string, name: string, failed: boolean) =>
            ({
                id,
                name,
                summary: {state: "done", failed},
                step: {traceId: `${id}-t`, spanId: null, metrics: {}},
            }) as unknown as ScenarioEvaluatorResult
        const judges = scenarioJudges(
            {cells: {}} as unknown as ScenarioRow,
            [],
            [
                result("a", "Bench check: short-to-read", false),
                result("b", "Bench check: talk-about-the-work", true),
                result("c", "Bench check: low-effort", true),
            ],
            {steps: [], mappings: []},
        )
        expect(judges.map((judge) => judge.name)).toEqual([
            "Bench check: low-effort",
            "Bench check: talk-about-the-work",
            "Bench check: short-to-read",
        ])
        // No span id (a run made with the SDK): a review has nothing to link.
        expect(judges.every((judge) => !judge.reviewable)).toBe(true)
    })

    it("The correctable leaves of nested outputs are found and set by path", () => {
        const outputs = {success: false, reason: "too long", quality: {score: 0.2, label: "low"}}
        expect(scalarLeaves(outputs)).toEqual([
            {path: ["success"], value: false},
            {path: ["quality", "score"], value: 0.2},
        ])
        expect(setAtPath(outputs, ["quality", "score"], 0.9)).toEqual({
            success: false,
            reason: "too long",
            quality: {score: 0.9, label: "low"},
        })
    })
})
