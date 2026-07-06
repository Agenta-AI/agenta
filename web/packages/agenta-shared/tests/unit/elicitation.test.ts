import {readFileSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

import {
    ELICITATION_RENDER_KIND,
    SECRET_FIELD_PATTERN,
    buildAcceptResult,
    buildCancelResult,
    buildDeclineResult,
    buildDegradationErrorText,
    deriveElicitationPartState,
    hasPriorElicitationDegradation,
    parseElicitationPayload,
    serializeElicitationContent,
} from "../../src/utils/elicitation"

const fixture = (name: string) =>
    JSON.parse(readFileSync(join(__dirname, "..", "fixtures", name), "utf-8"))

const validPayload = () => ({
    message: "Need a value",
    requestedSchema: {
        type: "object",
        properties: {
            name: {type: "string", title: "Name"},
            count: {type: "integer", minimum: 1},
            level: {type: "string", enum: ["low", "high"]},
            active: {type: "boolean"},
        },
        required: ["name"],
    },
})

describe("parseElicitationPayload", () => {
    it("accepts a valid flat payload", () => {
        const result = parseElicitationPayload(validPayload())
        expect(result.ok).toBe(true)
    })

    it("accepts the golden request fixture (cross-language contract)", () => {
        const result = parseElicitationPayload(fixture("elicitation_request.json"))
        expect(result.ok).toBe(true)
        expect(fixture("elicitation_request.json").render.kind).toBe(ELICITATION_RENDER_KIND)
    })

    it("rejects a non-object payload", () => {
        expect(parseElicitationPayload("nope")).toEqual({
            ok: false,
            reason: "payload is not an object",
        })
    })

    it("rejects a missing or empty message", () => {
        const payload = validPayload() as Record<string, unknown>
        delete payload.message
        expect(parseElicitationPayload(payload)).toEqual({ok: false, reason: "missing message"})
        expect(parseElicitationPayload({...validPayload(), message: "  "})).toEqual({
            ok: false,
            reason: "missing message",
        })
    })

    it("rejects a missing requestedSchema and a non-object schema type", () => {
        expect(parseElicitationPayload({message: "hi"})).toEqual({
            ok: false,
            reason: "missing requestedSchema",
        })
        const payload = validPayload()
        payload.requestedSchema.type = "array" as never
        expect(parseElicitationPayload(payload).ok).toBe(false)
    })

    it("rejects empty properties", () => {
        const payload = validPayload()
        payload.requestedSchema.properties = {} as never
        expect(parseElicitationPayload(payload)).toEqual({
            ok: false,
            reason: "requestedSchema.properties is empty",
        })
    })

    it("rejects nested objects and arrays (flat dialect only)", () => {
        const nested = validPayload()
        ;(nested.requestedSchema.properties as Record<string, unknown>).config = {
            type: "string",
            properties: {inner: {type: "string"}},
        }
        expect(parseElicitationPayload(nested)).toEqual({
            ok: false,
            reason: 'property "config" is nested — flat dialect only',
        })
        const arr = validPayload()
        ;(arr.requestedSchema.properties as Record<string, unknown>).tags = {
            type: "string",
            items: {type: "string"},
        }
        expect(parseElicitationPayload(arr).ok).toBe(false)
    })

    it("rejects unsupported property types", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).blob = {type: "object"}
        expect(parseElicitationPayload(payload).ok).toBe(false)
    })

    it("accepts unknown string formats (renderer falls back to text input)", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).odd = {
            type: "string",
            format: "hologram",
        }
        expect(parseElicitationPayload(payload).ok).toBe(true)
    })

    it("accepts x-ag-* presentation hints without changing semantics", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).name = {
            type: "string",
            "x-ag-placeholder": "e.g. support-triage",
        }
        expect(parseElicitationPayload(payload).ok).toBe(true)
    })

    it("rejects non-string enums", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).level = {
            type: "string",
            enum: [1, 2],
        }
        expect(parseElicitationPayload(payload)).toEqual({
            ok: false,
            reason: 'property "level" enum must be strings',
        })
    })

    it("rejects secret-shaped fields by name and by title", () => {
        const byName = validPayload()
        ;(byName.requestedSchema.properties as Record<string, unknown>).api_key = {type: "string"}
        expect(parseElicitationPayload(byName)).toEqual({
            ok: false,
            reason: 'property "api_key" is secret-shaped — use a connect flow',
        })
        const byTitle = validPayload()
        ;(byTitle.requestedSchema.properties as Record<string, unknown>).value = {
            type: "string",
            title: "Provider password",
        }
        expect(parseElicitationPayload(byTitle).ok).toBe(false)
    })

    it("rejects required entries that are not properties", () => {
        const payload = validPayload()
        payload.requestedSchema.required = ["name", "ghost"]
        expect(parseElicitationPayload(payload)).toEqual({
            ok: false,
            reason: 'required field "ghost" is not a property',
        })
    })
})

describe("SECRET_FIELD_PATTERN", () => {
    it.each([
        "password",
        "passwd",
        "token",
        "api_key",
        "apiKey",
        "client-secret",
        "private_key",
        "access_key",
    ])("matches %s", (name) => expect(SECRET_FIELD_PATTERN.test(name)).toBe(true))

    it.each(["name", "timezone", "frequency", "message"])("does not match %s", (name) =>
        expect(SECRET_FIELD_PATTERN.test(name)).toBe(false),
    )
})

describe("result envelopes", () => {
    it("matches the golden response fixture shapes", () => {
        const golden = fixture("elicitation_response.json")
        expect(
            buildAcceptResult(golden.accept.content, golden.accept.humanFriendlyMessage),
        ).toEqual(golden.accept)
        expect(buildDeclineResult(golden.decline.humanFriendlyMessage)).toEqual(golden.decline)
        expect(buildCancelResult()).toEqual(golden.cancel)
    })

    it("omits humanFriendlyMessage when absent", () => {
        expect(buildAcceptResult({a: 1})).toEqual({action: "accept", content: {a: 1}})
        expect(buildDeclineResult()).toEqual({action: "decline"})
    })

    it("pins the degradation errorText shape against the fixture", () => {
        const golden = fixture("elicitation_response.json")
        expect(buildDegradationErrorText('property "config" is nested — flat dialect only')).toBe(
            golden.degradation_error_text,
        )
    })
})

describe("hasPriorElicitationDegradation", () => {
    it("detects an earlier elicitation degradation in the turn", () => {
        expect(
            hasPriorElicitationDegradation([
                {state: "output-error", errorText: buildDegradationErrorText("missing message")},
            ]),
        ).toBe(true)
        expect(
            hasPriorElicitationDegradation([{state: "output-error", errorText: "other failure"}]),
        ).toBe(false)
        expect(hasPriorElicitationDegradation([])).toBe(false)
        expect(hasPriorElicitationDegradation(undefined)).toBe(false)
    })
})

describe("serializeElicitationContent", () => {
    it("serializes date-like values per the schema format and passes others through", () => {
        const payload = {
            message: "when?",
            requestedSchema: {
                type: "object",
                properties: {
                    due: {type: "string", format: "date"},
                    at: {type: "string", format: "date-time"},
                    note: {type: "string"},
                },
            },
        }
        const stamp = new Date("2026-07-06T07:00:00.000Z")
        const out = serializeElicitationContent(payload, {
            due: stamp,
            at: stamp,
            note: "hello",
            skipped: undefined,
        })
        expect(out).toEqual({
            due: "2026-07-06",
            at: "2026-07-06T07:00:00.000Z",
            note: "hello",
        })
    })

    it("leaves non-date values on date fields untouched (already-serialized strings)", () => {
        const payload = {
            message: "when?",
            requestedSchema: {
                type: "object",
                properties: {due: {type: "string", format: "date"}},
            },
        }
        expect(serializeElicitationContent(payload, {due: "2026-07-06"})).toEqual({
            due: "2026-07-06",
        })
    })
})

describe("deriveElicitationPartState", () => {
    it("is pending while input is streaming or available", () => {
        expect(deriveElicitationPartState({state: "input-streaming"})).toBe("pending")
        expect(deriveElicitationPartState({state: "input-available"})).toBe("pending")
        expect(deriveElicitationPartState({})).toBe("pending")
    })

    it("maps output actions to settled states", () => {
        expect(
            deriveElicitationPartState({state: "output-available", output: {action: "accept"}}),
        ).toBe("submitted")
        expect(
            deriveElicitationPartState({state: "output-available", output: {action: "decline"}}),
        ).toBe("declined")
        expect(
            deriveElicitationPartState({state: "output-available", output: {action: "cancel"}}),
        ).toBe("cancelled")
    })

    it("treats an output without a recognizable action as submitted (tolerant reader)", () => {
        expect(deriveElicitationPartState({state: "output-available", output: {}})).toBe(
            "submitted",
        )
    })

    it("is degraded on output-error or errorText", () => {
        expect(deriveElicitationPartState({state: "output-error"})).toBe("degraded")
        expect(
            deriveElicitationPartState({
                state: "output-available",
                errorText: buildDegradationErrorText("missing message"),
            }),
        ).toBe("degraded")
    })
})
