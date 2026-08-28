/**
 * Unit tests for the step model behind the docked elicitation card.
 *
 * The load-bearing property is TOTALITY: `buildElicitationSteps` must produce a usable step for
 * every payload `parseElicitationPayload` accepts. A field shape this version doesn't render yet
 * degrades to a plain control; it never throws and never reports "unrenderable", because that would
 * settle the tool with `errorText` and kill a run the user could have answered.
 */
import {describe, expect, it} from "vitest"

import goldenRequest from "../fixtures/elicitation_request.json"

import {parseElicitationPayload, type ElicitationRequestPayload} from "../../src/utils/elicitation"
import {
    buildElicitationSteps,
    collectStepContent,
    formatStepValue,
    initialStepValues,
    isStepAnswered,
    parseSecretRefusal,
    parseStepValue,
    validateStep,
    type ElicitationStep,
} from "../../src/utils/elicitationSteps"

/** Parse first — the builder's contract is only defined over payloads parse admits. */
const formOf = (raw: unknown) => {
    const parsed = parseElicitationPayload(raw)
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.reason}`)
    return buildElicitationSteps(parsed.payload)
}

const stepBy = (steps: ElicitationStep[], name: string): ElicitationStep => {
    const step = steps.find((candidate) => candidate.name === name)
    if (!step) throw new Error(`no step named ${name}`)
    return step
}

const payload = (
    properties: Record<string, unknown>,
    required: string[] = [],
): Record<string, unknown> => ({
    message: "Answer these",
    requestedSchema: {type: "object", properties, required},
})

describe("buildElicitationSteps — totality", () => {
    it("produces one usable step per property of the golden request fixture", () => {
        const {steps, message} = formOf(goldenRequest)

        expect(message).toBe(
            "When should this agent run? I need a schedule before I can set it up.",
        )
        // Schema order, not required-first: the agent authored these as a narrative.
        expect(steps.map((step) => step.name)).toEqual([
            "frequency",
            "run_schedule",
            "time_of_day",
            "timezone",
            "delivery_message",
            "active",
            "notify_on",
        ])
        for (const step of steps) {
            expect(step.kind).not.toBe("unsupported")
            expect(step.label.trim()).not.toBe("")
        }
    })

    it("never throws on a payload carrying only the dialect's minimum", () => {
        expect(() => formOf(payload({q: {type: "string"}}))).not.toThrow()
    })

    it("falls back to the property name when a field has no title", () => {
        const {steps} = formOf(payload({repo_slug: {type: "string"}}))
        expect(steps[0].label).toBe("repo_slug")
    })

    it("carries x-ag-stepper without acting on it", () => {
        const withHint = formOf({
            message: "m",
            requestedSchema: {
                type: "object",
                properties: {q: {type: "string"}},
                "x-ag-stepper": true,
            },
        })
        const without = formOf(payload({q: {type: "string"}}))

        expect(withHint.groupHint).toBe(true)
        expect(without.groupHint).toBe(false)
        // The only difference is the flag — the steps are identical either way.
        expect(withHint.steps).toEqual(without.steps)
    })
})

describe("buildElicitationSteps — kinds", () => {
    it("maps each v1 kind off the golden fixture", () => {
        const {steps} = formOf(goldenRequest)

        expect(stepBy(steps, "frequency").kind).toBe("enum")
        expect(stepBy(steps, "timezone").kind).toBe("enum")
        expect(stepBy(steps, "delivery_message").kind).toBe("multiline")
        expect(stepBy(steps, "active").kind).toBe("boolean")
    })

    it("treats integer as a number step that rejects fractions", () => {
        const {steps} = formOf(payload({days: {type: "integer", minimum: 1, maximum: 90}}))

        expect(steps[0].kind).toBe("number")
        expect(steps[0].integer).toBe(true)
        // The design's `1–90` hint, derived rather than decorative.
        expect(steps[0].hint).toBe("1–90")
        expect(validateStep(steps[0], 1.5)).toBe("Whole numbers only")
    })

    it("marks required off the schema's required list", () => {
        const {steps} = formOf(payload({a: {type: "string"}, b: {type: "string"}}, ["b"]))

        expect(stepBy(steps, "a").required).toBe(false)
        expect(stepBy(steps, "b").required).toBe(true)
    })

    it("gives every enum an Other row — options are suggestions, not a constraint", () => {
        const {steps} = formOf(payload({colour: {type: "string", enum: ["Red", "Blue"]}}))

        expect(steps[0].allowOther).toBe(true)
        expect(steps[0].options).toEqual([
            {value: "Red", label: "Red"},
            {value: "Blue", label: "Blue"},
        ])
    })

    it("prefers the author's description over a generated hint", () => {
        const {steps} = formOf(goldenRequest)
        expect(stepBy(steps, "time_of_day").hint).toBe(
            "Local time; the server converts to UTC cron.",
        )
    })
})

describe("buildElicitationSteps — degrade lanes", () => {
    it("keeps a oneOf option's title and description on its row", () => {
        const step = stepBy(formOf(goldenRequest).steps, "frequency")

        expect(step.kind).toBe("enum")
        // Descriptions ride the row's own `?` affordance, so nothing about this is degraded.
        expect(step.degraded).toBeUndefined()
        expect(step.options?.[0]).toEqual({
            value: "hourly",
            label: "Hourly",
            description: "Runs every hour, on the hour.",
        })
    })

    it("promotes an enum-backed array to real toggle rows", () => {
        const step = stepBy(formOf(goldenRequest).steps, "notify_on")

        expect(step.kind).toBe("multiselect")
        expect(step.degraded).toBeUndefined()
        expect(step.options?.map((o) => o.value)).toEqual(["success", "failure", "skipped"])
        // Options are suggestions in this dialect, so a multi-select keeps its Other row too.
        expect(step.allowOther).toBe(true)
        // The control holds the array directly; nothing to split on the way out.
        expect(parseStepValue(step, ["failure"])).toEqual(["failure"])
    })

    it("gives an array with nothing to pick a chip field", () => {
        const {steps} = formOf(payload({repos: {type: "array", items: {type: "string"}}}))

        expect(steps[0].kind).toBe("list")
        expect(steps[0].degraded).toBeUndefined()
        // A draft written before chips existed is still a comma string; it must still restore.
        expect(parseStepValue(steps[0], "a, b")).toEqual(["a", "b"])
        expect(parseStepValue(steps[0], ["a", "b"])).toEqual(["a", "b"])
    })

    it.each([
        ["date", "date"],
        ["date-time", "date-time"],
    ])("gives format %s its own picker rather than a text field", (format, kind) => {
        const {steps} = formOf(payload({q: {type: "string", format}}))

        expect(steps[0].kind).toBe(kind)
        expect(steps[0].degraded).toBeUndefined()
    })

    it.each([
        ["email", "you@example.com"],
        ["uri", "https://…"],
    ])("renders format %s as a text field hinted %s, and records the shape", (format, hint) => {
        const {steps} = formOf(payload({q: {type: "string", format}}))

        expect(steps[0].kind).toBe("text")
        expect(steps[0].format).toBe(format)
        expect(steps[0].hint).toBe(hint)
    })

    it("leaves cron as the last degrade lane", () => {
        const {steps} = formOf(payload({q: {type: "string", format: "cron"}}))

        expect(steps[0].kind).toBe("text")
        expect(steps[0].degraded).toBe("cron")
        expect(steps[0].hint).toBe("5 fields, e.g. 0 9 * * 1-5")
    })

    it("keeps every option past the ninth — the digit shortcut is the only thing that runs out", () => {
        const options = Array.from({length: 14}, (_, i) => `model-${i}`)
        const {steps} = formOf(payload({model: {type: "string", enum: options}}))

        expect(steps[0].options).toHaveLength(14)
    })

    it("drops an unknown format to plain text rather than degrading", () => {
        // The parser strips unknown formats at the boundary, so nothing reaches the builder.
        const {steps} = formOf(payload({q: {type: "string", format: "colour-picker"}}))

        expect(steps[0].kind).toBe("text")
        expect(steps[0].degraded).toBeUndefined()
    })
})

describe("defaults", () => {
    it("seeds values from the schema so a fully-defaulted form is answerable in one pass", () => {
        const {steps} = formOf(goldenRequest)

        expect(initialStepValues(steps)).toEqual({
            run_schedule: "0 9 * * *",
            timezone: "UTC",
            active: true,
            notify_on: ["failure"],
        })
    })

    it("counts a defaulted field as answered", () => {
        const {steps} = formOf(goldenRequest)
        const values = initialStepValues(steps)

        expect(isStepAnswered(stepBy(steps, "timezone"), values.timezone)).toBe(true)
        expect(validateStep(stepBy(steps, "timezone"), values.timezone)).toBeNull()
    })
})

describe("validateStep", () => {
    it("uses pick-one wording for an enum and required wording elsewhere", () => {
        const {steps} = formOf(
            payload({colour: {type: "string", enum: ["Red"]}, name: {type: "string"}}, [
                "colour",
                "name",
            ]),
        )

        expect(validateStep(stepBy(steps, "colour"), undefined)).toBe("Pick one to continue")
        expect(validateStep(stepBy(steps, "name"), "  ")).toBe("This one is required")
    })

    it("checks the formats the dialect implies but never enforced", () => {
        const {steps} = formOf(
            payload({
                who: {type: "string", format: "email"},
                where: {type: "string", format: "uri"},
                due: {type: "string", format: "date"},
            }),
        )

        expect(validateStep(stepBy(steps, "who"), "ada@example.com")).toBeNull()
        expect(validateStep(stepBy(steps, "who"), "ada@example")).toBe(
            "Needs a valid email address",
        )
        expect(validateStep(stepBy(steps, "where"), "https://agenta.ai")).toBeNull()
        expect(validateStep(stepBy(steps, "where"), "agenta.ai")).toBe(
            "Needs a full URL, including the scheme",
        )
        expect(validateStep(stepBy(steps, "due"), "2026-03-04")).toBeNull()
        expect(validateStep(stepBy(steps, "due"), "the 4th")).toBe("That isn't a real date")
    })

    it("leaves a cron expression to the agent — an odd one is a decision, not a typo", () => {
        const {steps} = formOf(payload({when: {type: "string", format: "cron"}}))

        expect(validateStep(steps[0], "@daily")).toBeNull()
    })

    it.each(["(a+)+$", "(a*)*$", "^(a+)*", "(a{2,})+", "((ab)+)+"])(
        "skips the catastrophic pattern %s rather than handing it to RegExp.test",
        (pattern) => {
            // The schema is model-authored, so a nested quantifier could pin the browser thread.
            const {steps} = formOf(payload({code: {type: "string", pattern}}))
            expect(validateStep(steps[0], "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBeNull()
        },
    )

    it.each(["^[A-Z]{3}$", "^\\d+$", "^(cat|dog)$", "(a[+])+", "([*])+"])(
        "still enforces the ordinary pattern %s",
        (pattern) => {
            const {steps} = formOf(payload({code: {type: "string", pattern}}))
            expect(validateStep(steps[0], "!!!")).toBe("That doesn't match the expected format")
        },
    )

    it("checks an email by hand, so a crafted address cannot stall the check", () => {
        const {steps} = formOf(payload({who: {type: "string", format: "email"}}))
        const ok = (value: string) => validateStep(steps[0], value) === null

        expect(ok("ada@example.com")).toBe(true)
        expect(ok("ada@mail.example.co.uk")).toBe(true)
        expect(ok("ada@example")).toBe(false)
        expect(ok("@example.com")).toBe(false)
        expect(ok("ada@@example.com")).toBe(false)
        expect(ok("ada@.com")).toBe(false)
        expect(ok("ada@example.")).toBe(false)
        // The shape CodeQL flagged on the old regex. It is invalid either way (trailing dot); what
        // matters is that the check is index arithmetic now, so it returns instead of backtracking.
        expect(ok(`a@${"!.".repeat(2000)}`)).toBe(false)
        expect(ok(`a@${"!.".repeat(2000)}x`)).toBe(true)
    })

    it("lets an unanswered optional step through", () => {
        const {steps} = formOf(payload({note: {type: "string"}}))
        expect(validateStep(steps[0], undefined)).toBeNull()
    })

    it("enforces the numeric bounds the dialect carries", () => {
        const {steps} = formOf(payload({days: {type: "integer", minimum: 1, maximum: 90}}))

        expect(validateStep(steps[0], 0)).toBe("Must be 1 or more")
        expect(validateStep(steps[0], 91)).toBe("Must be 90 or less")
        expect(validateStep(steps[0], 30)).toBeNull()
    })

    it("enforces length and pattern", () => {
        const {steps} = formOf(
            payload({code: {type: "string", minLength: 3, maxLength: 4, pattern: "^[a-z]+$"}}),
        )

        expect(validateStep(steps[0], "ab")).toBe("At least 3 characters")
        expect(validateStep(steps[0], "abcde")).toBe("At most 4 characters")
        expect(validateStep(steps[0], "AB3")).toBe("That doesn't match the expected format")
        expect(validateStep(steps[0], "abc")).toBeNull()
    })

    it("ignores an author's unparseable pattern instead of blocking a good answer", () => {
        const {steps} = formOf(payload({code: {type: "string", pattern: "([unclosed"}}))
        expect(validateStep(steps[0], "anything")).toBeNull()
    })

    it("treats false as an answer", () => {
        const {steps} = formOf(payload({digest: {type: "boolean"}}, ["digest"]))

        expect(isStepAnswered(steps[0], false)).toBe(true)
        expect(validateStep(steps[0], false)).toBeNull()
        expect(validateStep(steps[0], undefined)).toBe("This one is required")
    })
})

describe("collectStepContent", () => {
    it("sends answered values and omits skipped ones", () => {
        const {steps} = formOf(
            payload({name: {type: "string"}, days: {type: "number"}, note: {type: "string"}}),
        )

        expect(collectStepContent(steps, {name: "Ada", days: 30, note: "   "})).toEqual({
            name: "Ada",
            days: 30,
        })
    })

    it("splits a list step on the way out", () => {
        // A list is the no-enum array: nothing to offer as rows, so it is typed and split here.
        const {steps} = formOf(payload({repos: {type: "array", items: {type: "string"}}}))
        expect(collectStepContent(steps, {repos: "a/one, a/two"})).toEqual({
            repos: ["a/one", "a/two"],
        })
    })

    it("passes a multi-select's array through untouched", () => {
        const {steps} = formOf(goldenRequest)
        expect(collectStepContent(steps, {notify_on: ["success", "failure"]})).toEqual({
            notify_on: ["success", "failure"],
        })
    })

    it("never serializes an unsupported step", () => {
        const step: ElicitationStep = {
            name: "mystery",
            label: "Mystery",
            kind: "unsupported",
            required: false,
            allowOther: false,
            integer: false,
        }

        expect(validateStep(step, undefined)).toBeNull()
        expect(collectStepContent([step], {mystery: "anything"})).toEqual({})
    })
})

describe("formatStepValue", () => {
    it("prints review and settled-summary rows", () => {
        const {steps} = formOf(goldenRequest)

        expect(formatStepValue(stepBy(steps, "frequency"), "hourly")).toBe("Hourly")
        expect(formatStepValue(stepBy(steps, "active"), true)).toBe("Yes")
        expect(formatStepValue(stepBy(steps, "active"), false)).toBe("No")
        expect(formatStepValue(stepBy(steps, "notify_on"), ["success", "failure"])).toBe(
            "success, failure",
        )
        expect(formatStepValue(stepBy(steps, "timezone"), undefined)).toBe("Skipped")
    })

    it("prints a date as a date, not as the ISO string on the wire", () => {
        const {steps} = formOf(
            payload({
                due: {type: "string", format: "date"},
                at: {type: "string", format: "date-time"},
            }),
        )

        expect(formatStepValue(stepBy(steps, "due"), "2026-03-04")).toBe("2026-03-04")
        expect(formatStepValue(stepBy(steps, "at"), "2026-03-04T09:30:00.000Z")).toMatch(
            /^2026-03-04 \d{2}:\d{2}$/,
        )
        // Unparseable values still print, rather than showing the user "Invalid Date".
        expect(formatStepValue(stepBy(steps, "due"), "sometime")).toBe("sometime")
    })

    it("prints an Other value verbatim, since it matches no option", () => {
        const {steps} = formOf(payload({colour: {type: "string", enum: ["Red"]}}))
        expect(formatStepValue(steps[0], "Chartreuse")).toBe("Chartreuse")
    })
})

describe("parseSecretRefusal", () => {
    it("names the offending property so the refusal panel can quote it", () => {
        const parsed = parseElicitationPayload({
            message: "m",
            requestedSchema: {type: "object", properties: {api_key: {type: "string"}}},
        })

        expect(parsed.ok).toBe(false)
        if (parsed.ok) return
        expect(parseSecretRefusal(parsed.reason)).toEqual({property: "api_key"})
    })

    it("returns null for every other rejection", () => {
        expect(parseSecretRefusal("requestedSchema.properties is empty")).toBeNull()
    })
})
