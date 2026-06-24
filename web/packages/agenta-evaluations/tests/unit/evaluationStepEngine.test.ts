import {describe, expect, it} from "vitest"

import {
    assertValidStepConfig,
    composeEvaluationStepPayload,
    findFirstIncompleteRequiredStep,
    findInitialEvaluationStep,
    findNextEvaluationStep,
    isEvaluationStepEnabled,
    splitEvaluationPayloadByInvocationStep,
    type EvaluationStepDescriptorMap,
    type EvaluationStepSlot,
} from "../../src/core/evaluationStepEngine"

type Kind = "invocation" | "revision" | "evaluator" | "advanced" | "traces" | "query"
type Values = Partial<Record<Kind, unknown>>
interface Payload {
    application_steps?: Record<string, "auto">
    evaluator_steps?: Record<string, "auto">
}

const descriptors: EvaluationStepDescriptorMap<Kind, Values, Values, Payload> = {
    invocation: {
        kind: "invocation",
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
    traces: {
        kind: "traces",
        defaultValue: [],
        isComplete: (value) => Array.isArray(value) && value.length > 0,
    },
    query: {
        kind: "query",
        defaultValue: {},
        isComplete: (value) => Boolean((value as {queryId?: string}).queryId),
    },
}

const getValue = (values: Values) => (kind: Kind) => values[kind]

describe("evaluation step engine", () => {
    it("validates missing, duplicate, and cyclic dependencies", () => {
        const knownKinds = new Set<Kind>([
            "invocation",
            "revision",
            "evaluator",
            "advanced",
            "traces",
            "query",
        ])
        expect(() =>
            assertValidStepConfig([{kind: "revision", dependsOn: ["invocation"]}], knownKinds),
        ).toThrow(/missing step/)
        expect(() =>
            assertValidStepConfig([{kind: "invocation"}, {kind: "invocation"}], knownKinds),
        ).toThrow(/Duplicate/)
        expect(() =>
            assertValidStepConfig(
                [
                    {kind: "invocation", dependsOn: ["revision"]},
                    {kind: "revision", dependsOn: ["invocation"]},
                ],
                knownKinds,
            ),
        ).toThrow(/Cyclic/)
    })

    it("validates mutually exclusive step groups", () => {
        const knownKinds = new Set<Kind>([
            "invocation",
            "revision",
            "evaluator",
            "advanced",
            "traces",
            "query",
        ])
        const sourceGroups: Kind[][] = [["traces", "query"]]

        expect(() =>
            assertValidStepConfig(
                [{kind: "traces"}, {kind: "query"}, {kind: "evaluator"}],
                knownKinds,
                sourceGroups,
            ),
        ).toThrow(/Mutually exclusive/)
        expect(() =>
            assertValidStepConfig(
                [{kind: "traces"}, {kind: "evaluator"}],
                knownKinds,
                sourceGroups,
            ),
        ).not.toThrow()
        expect(() =>
            assertValidStepConfig([{kind: "query"}, {kind: "evaluator"}], knownKinds, sourceGroups),
        ).not.toThrow()
    })

    it("gates steps only on declared dependencies", () => {
        const values: Values = {invocation: "", revision: [], evaluator: [], advanced: {}}
        const revision: EvaluationStepSlot<Kind> = {
            kind: "revision",
            dependsOn: ["invocation"],
        }
        expect(isEvaluationStepEnabled(revision, descriptors, getValue(values), values)).toBe(false)
        expect(
            isEvaluationStepEnabled({kind: "advanced"}, descriptors, getValue(values), values),
        ).toBe(true)
    })

    it("chooses and advances through enabled incomplete steps in config order", () => {
        const slots: EvaluationStepSlot<Kind>[] = [
            {kind: "invocation"},
            {kind: "revision", dependsOn: ["invocation"]},
            {kind: "evaluator", dependsOn: ["invocation"]},
            {kind: "advanced"},
        ]
        const values: Values = {
            invocation: "workflow-1",
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
        const values: Values = {invocation: "", revision: [], evaluator: [], advanced: {}}
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
            invocation: "",
            revision: ["rev-1"],
            evaluator: ["eval-1"],
            advanced: {},
        }
        await expect(
            composeEvaluationStepPayload(
                [{kind: "invocation"}, {kind: "revision"}, {kind: "evaluator"}],
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

    it("fans out invocation payload entries while preserving payloads without invocations", () => {
        expect(
            splitEvaluationPayloadByInvocationStep({
                evaluator_steps: {"eval-1": "auto"},
            }),
        ).toEqual([{evaluator_steps: {"eval-1": "auto"}}])

        expect(
            splitEvaluationPayloadByInvocationStep({
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
