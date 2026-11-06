import type {EvaluatorEntry, Workflow} from "@agenta/entities/workflow"
import {describe, expect, it} from "vitest"

import {
    draftFromEvaluator,
    draftToMetrics,
    emptyFeedbackField,
    emptyHumanEvaluatorDraft,
    validateHumanEvaluator,
    withFieldType,
    type HumanEvaluatorDraft,
} from "@/features/evaluators/human/humanEvaluatorForm"

const draft = (fields: Partial<HumanEvaluatorDraft["fields"][number]>[]): HumanEvaluatorDraft => ({
    name: "Answer quality",
    slug: "answer-quality",
    description: "",
    fields: fields.map((field) => ({...emptyFeedbackField(), ...field})),
})

describe("validateHumanEvaluator", () => {
    it("asks for a name, a slug, a feedback name and a type in an empty form", () => {
        expect(validateHumanEvaluator(emptyHumanEvaluatorDraft())).toEqual({
            name: "Enter a name.",
            slug: "Enter a slug.",
            "fields.0.name": "Enter a feedback name.",
            "fields.0.type": "Pick a feedback type.",
        })
    })

    it("refuses a slug or a feedback name with spaces, and a repeated feedback name", () => {
        const errors = validateHumanEvaluator({
            ...draft([
                {name: "score", type: "boolean"},
                {name: "score", type: "string"},
                {name: "my note", type: "string"},
            ]),
            slug: "answer quality",
        })
        expect(Object.keys(errors).sort()).toEqual(["fields.1.name", "fields.2.name", "slug"])
        expect(errors["fields.1.name"]).toBe("This name is already used.")
    })

    it("checks the range of a number feedback", () => {
        const errors = validateHumanEvaluator(
            draft([
                {name: "score", type: "integer", minimum: "1.5", maximum: "5"},
                {name: "ratio", type: "number", minimum: "1", maximum: "0.5"},
            ]),
        )
        expect(errors).toEqual({
            "fields.0.minimum": "Enter a whole number.",
            "fields.1.maximum": "The maximum must be greater than the minimum.",
        })
    })

    it("asks for an option in a choice feedback and refuses a repeated option", () => {
        const errors = validateHumanEvaluator(
            draft([
                {name: "tone", type: "class", options: ["", " "]},
                {name: "topics", type: "label", options: ["billing", "billing"]},
            ]),
        )
        expect(errors).toEqual({
            "fields.0.options": "Add at least one option.",
            "fields.1.options.1": "This option is already added.",
        })
    })
})

describe("draftToMetrics", () => {
    it("sends parsed numbers and the filled options only", () => {
        expect(
            draftToMetrics(
                draft([
                    {name: " score ", type: "integer", minimum: "1", maximum: "5"},
                    {name: "tone", type: "class", options: ["calm", "", "rude"], optional: true},
                    {name: "note", type: "string"},
                ]),
            ),
        ).toEqual([
            {name: "score", type: "integer", optional: false, minimum: 1, maximum: 5},
            {name: "tone", type: "class", optional: true, enum: ["calm", "rude"]},
            {name: "note", type: "string", optional: false},
        ])
    })
})

describe("withFieldType", () => {
    it("starts a choice type with one empty option and drops a range it no longer needs", () => {
        const number = {...emptyFeedbackField(), type: "integer", minimum: "1", maximum: "5"}
        const choice = withFieldType(number, "class")
        expect(choice).toMatchObject({type: "class", minimum: "", maximum: "", options: [""]})
    })
})

describe("draftFromEvaluator", () => {
    it("fills the form from the evaluator and its latest outputs schema", () => {
        const entry = {
            workflow: {id: "w1", name: "Helpfulness", slug: "helpfulness", description: "Rate it"},
            latestRevision: {
                id: "r2",
                data: {
                    uri: "agenta:custom:feedback:v0",
                    schemas: {
                        outputs: {
                            type: "object",
                            properties: {
                                score: {type: "integer", minimum: 1, maximum: 5},
                                comment: {type: "string"},
                            },
                            required: ["score"],
                        },
                    },
                },
            },
        } as unknown as EvaluatorEntry & {latestRevision: Workflow}
        const result = draftFromEvaluator(entry)
        expect({...result, fields: result.fields.map(({key: _key, ...rest}) => rest)}).toEqual({
            name: "Helpfulness",
            slug: "helpfulness",
            description: "Rate it",
            fields: [
                {
                    name: "score",
                    type: "integer",
                    optional: false,
                    minimum: "1",
                    maximum: "5",
                    options: [],
                },
                {
                    name: "comment",
                    type: "string",
                    optional: true,
                    minimum: "",
                    maximum: "",
                    options: [],
                },
            ],
        })
    })
})
