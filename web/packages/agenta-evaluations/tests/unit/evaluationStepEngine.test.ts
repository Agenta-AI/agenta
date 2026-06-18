import {describe, expect, it} from "vitest"

import {
    assertValidStepConfig,
    composeEvaluationStepPayload,
    findFirstIncompleteRequiredStep,
    findInitialEvaluationStep,
    findNextEvaluationStep,
    isEvaluationStepEnabled,
    splitEvaluationPayloadByApplicationStep,
    type EvaluationStepDescriptorMap,
    type EvaluationStepSlot,
} from "../../src/core/evaluationStepEngine"

type Kind = "application" | "revision" | "evaluator" | "advanced"
type Values = Record<Kind, unknown>
interface Payload {
    application_steps?: Record<string, "auto">
    evaluator_steps?: Record<string, "auto">
}

const descriptors: EvaluationStepDescriptorMap<Kind, Values, Payload> = {
    application: {
        kind: "application",
        defaultValue: "",
        isComplete: (value) => Boolean(value),
        toPayload: async (_value, context) => ({
            application_steps: Object.fromEntries(
                (context.revision as string[]).map((id) => [id, "auto" as const]),
            ),
        }),
    },
    revision: {
        kind: "revision",
        defaultValue: [],
        isComplete: (value) => Array.isArray(value) && value.length > 0,
    },
    evaluator: {
        kind: "evaluator",
        defaultValue: [],
        isComplete: (value) => Array.isArray(value) && value.length > 0,
        toPayload: async (value) => ({
            evaluator_steps: Object.fromEntries(
                (value as string[]).map((id) => [id, "auto" as const]),
            ),
        }),
    },
    advanced: {
        kind: "advanced",
        defaultValue: {},
        isComplete: () => true,
    },
}

const getValue = (values: Values) => (kind: Kind) => values[kind]

describe("evaluation step engine", () => {
    it("validates missing, duplicate, and cyclic dependencies", () => {
        const knownKinds = new Set<Kind>(["application", "revision", "evaluator", "advanced"])
        expect(() =>
            assertValidStepConfig([{kind: "revision", dependsOn: ["application"]}], knownKinds),
        ).toThrow(/missing step/)
        expect(() =>
            assertValidStepConfig([{kind: "application"}, {kind: "application"}], knownKinds),
        ).toThrow(/Duplicate/)
        expect(() =>
            assertValidStepConfig(
                [
                    {kind: "application", dependsOn: ["revision"]},
                    {kind: "revision", dependsOn: ["application"]},
                ],
                knownKinds,
            ),
        ).toThrow(/Cyclic/)
    })

    it("gates steps only on declared dependencies", () => {
        const values: Values = {application: "", revision: [], evaluator: [], advanced: {}}
        const revision: EvaluationStepSlot<Kind> = {
            kind: "revision",
            dependsOn: ["application"],
        }
        expect(isEvaluationStepEnabled(revision, descriptors, getValue(values), values)).toBe(false)
        expect(
            isEvaluationStepEnabled({kind: "advanced"}, descriptors, getValue(values), values),
        ).toBe(true)
    })

    it("chooses and advances through enabled incomplete steps in config order", () => {
        const slots: EvaluationStepSlot<Kind>[] = [
            {kind: "application"},
            {kind: "revision", dependsOn: ["application"]},
            {kind: "evaluator", dependsOn: ["application"]},
            {kind: "advanced"},
        ]
        const values: Values = {
            application: "app-1",
            revision: ["rev-1"],
            evaluator: [],
            advanced: {},
        }
        expect(findInitialEvaluationStep(slots, descriptors, getValue(values), values)).toBe(
            "evaluator",
        )
        expect(
            findNextEvaluationStep("revision", slots, descriptors, getValue(values), values),
        ).toBe("evaluator")
    })

    it("validates only configured required steps", () => {
        const slots: EvaluationStepSlot<Kind>[] = [
            {kind: "evaluator", required: true},
            {kind: "advanced"},
        ]
        const values: Values = {application: "", revision: [], evaluator: [], advanced: {}}
        expect(findFirstIncompleteRequiredStep(slots, descriptors, getValue(values), values)).toBe(
            "evaluator",
        )
        values.evaluator = ["eval-1"]
        expect(
            findFirstIncompleteRequiredStep(slots, descriptors, getValue(values), values),
        ).toBeNull()
    })

    it("composes payload only from configured descriptors", async () => {
        const values: Values = {
            application: "",
            revision: ["rev-1"],
            evaluator: ["eval-1"],
            advanced: {},
        }
        await expect(
            composeEvaluationStepPayload(
                [{kind: "application"}, {kind: "revision"}, {kind: "evaluator"}],
                descriptors,
                getValue(values),
                values,
            ),
        ).resolves.toEqual({
            application_steps: {"rev-1": "auto"},
            evaluator_steps: {"eval-1": "auto"},
        })

        await expect(
            composeEvaluationStepPayload(
                [{kind: "evaluator"}],
                descriptors,
                getValue(values),
                values,
            ),
        ).resolves.toEqual({
            evaluator_steps: {"eval-1": "auto"},
        })
    })

    it("fans out application steps while preserving no-application payloads", () => {
        expect(
            splitEvaluationPayloadByApplicationStep({
                evaluator_steps: {"eval-1": "auto"},
            }),
        ).toEqual([{evaluator_steps: {"eval-1": "auto"}}])

        expect(
            splitEvaluationPayloadByApplicationStep({
                application_steps: {"rev-1": "auto", "rev-2": "custom"},
                evaluator_steps: {"eval-1": "auto"},
            }),
        ).toEqual([
            {
                application_steps: {"rev-1": "auto"},
                evaluator_steps: {"eval-1": "auto"},
            },
            {
                application_steps: {"rev-2": "custom"},
                evaluator_steps: {"eval-1": "auto"},
            },
        ])
    })
})
