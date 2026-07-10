import {readFileSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

import {buildFormFieldsFromSchema} from "../../src/utils/gatewayToolSchema"
import {
    ELICITATION_RENDER_KIND,
    SECRET_FIELD_PATTERN,
    buildAcceptResult,
    buildCancelResult,
    buildDeclineResult,
    buildDegradationErrorText,
    deriveElicitationPartState,
    hasPriorElicitationDegradation,
    normalizeStringFormat,
    parseElicitationPayload,
    partitionElicitationDraft,
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

    it("canonicalizes format aliases and drops unknown formats on the parsed payload", () => {
        const payload = validPayload()
        const props = payload.requestedSchema.properties as Record<string, unknown>
        props.at = {type: "string", format: "datetime"}
        props.notes = {type: "string", format: "textarea"}
        props.odd = {type: "string", format: "hologram"}
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const parsed = result.payload.requestedSchema.properties
        expect(parsed.at.format).toBe("date-time")
        expect(parsed.notes.format).toBe("multiline")
        expect("format" in parsed.odd).toBe(false)
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

    it("accepts primitive defaults and keeps them on the parsed payload", () => {
        const payload = validPayload()
        const props = payload.requestedSchema.properties as Record<string, unknown>
        props.name = {type: "string", title: "Name", default: "Ada"}
        props.count = {type: "integer", minimum: 1, default: 3}
        props.active = {type: "boolean", default: true}
        props.level = {type: "string", enum: ["low", "high"], default: "high"}
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const parsed = result.payload.requestedSchema.properties
        expect(parsed.name.default).toBe("Ada")
        expect(parsed.count.default).toBe(3)
        expect(parsed.active.default).toBe(true)
        expect(parsed.level.default).toBe("high")
    })

    it("rejects defaults that do not match the declared type", () => {
        const cases: [Record<string, unknown>, string][] = [
            [{type: "string", default: {nested: true}}, 'default must match type "string"'],
            [{type: "string", default: ["a"]}, 'default must match type "string"'],
            [{type: "integer", default: "3"}, 'default must match type "integer"'],
            [{type: "integer", default: 3.5}, 'default must match type "integer"'],
            [{type: "boolean", default: "true"}, 'default must match type "boolean"'],
            [{type: "number", default: Number.NaN}, 'default must match type "number"'],
        ]
        for (const [prop, suffix] of cases) {
            const payload = validPayload()
            ;(payload.requestedSchema.properties as Record<string, unknown>).x = prop
            expect(parseElicitationPayload(payload)).toEqual({
                ok: false,
                reason: `property "x" ${suffix}`,
            })
        }
        // Matching types stay accepted (number tolerates a float; integer requires whole).
        const ok = validPayload()
        ;(ok.requestedSchema.properties as Record<string, unknown>).ratio = {
            type: "number",
            default: 3.5,
        }
        expect(parseElicitationPayload(ok).ok).toBe(true)
    })

    it("strips empty defaults ('' and []) — models emit them to mean 'no proposal'", () => {
        const payload = validPayload()
        const props = payload.requestedSchema.properties as Record<string, unknown>
        props.level = {type: "string", enum: ["low", "high"], default: ""}
        props.tags = {type: "array", items: {type: "string"}, default: []}
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect("default" in result.payload.requestedSchema.properties.level).toBe(false)
        expect("default" in result.payload.requestedSchema.properties.tags).toBe(false)
    })

    it("rejects enum/oneOf on non-string scalar types", () => {
        const enumCase = validPayload()
        ;(enumCase.requestedSchema.properties as Record<string, unknown>).x = {
            type: "integer",
            enum: ["1", "2"],
        }
        expect(parseElicitationPayload(enumCase)).toEqual({
            ok: false,
            reason: 'property "x" enum/oneOf requires type "string"',
        })
        const oneOfCase = validPayload()
        ;(oneOfCase.requestedSchema.properties as Record<string, unknown>).x = {
            type: "boolean",
            oneOf: [{const: "yes"}],
        }
        expect(parseElicitationPayload(oneOfCase).ok).toBe(false)
    })

    it("folds misplaced top-level enum/oneOf on an array into items (declared items win)", () => {
        const payload = validPayload()
        const props = payload.requestedSchema.properties as Record<string, unknown>
        props.by_enum = {type: "array", items: {type: "string"}, enum: ["a", "b"]}
        props.by_one_of = {
            type: "array",
            items: {type: "string"},
            oneOf: [{const: "slack"}, {const: "email"}],
        }
        props.declared_wins = {
            type: "array",
            items: {type: "string", enum: ["x"]},
            enum: ["ignored"],
        }
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const parsed = result.payload.requestedSchema.properties
        expect(parsed.by_enum.items?.enum).toEqual(["a", "b"])
        expect(parsed.by_one_of.items?.enum).toEqual(["slack", "email"])
        expect(parsed.declared_wins.items?.enum).toEqual(["x"])
        // The top level is stripped so downstream never mis-promotes the field to single-select.
        for (const name of ["by_enum", "by_one_of", "declared_wins"]) {
            expect("enum" in parsed[name]).toBe(false)
            expect("oneOf" in parsed[name]).toBe(false)
        }
    })

    it("rejects malformed misplaced array options", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).x = {
            type: "array",
            items: {type: "string"},
            enum: [1, 2],
        }
        expect(parseElicitationPayload(payload)).toEqual({
            ok: false,
            reason: 'property "x" items enum must be strings',
        })
    })

    it("REGRESSION: a misplaced-oneOf array still builds as a multi-select, not a single enum", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).ch = {
            type: "array",
            items: {type: "string"},
            oneOf: [{const: "slack"}, {const: "email"}],
        }
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const descriptor = buildFormFieldsFromSchema(
            result.payload.requestedSchema as unknown as Record<string, unknown>,
            "",
            {openEnums: true},
        ).find((f) => f.name === "ch")
        expect(descriptor?.type).toBe("array")
        expect(descriptor?.multiple).toBe(true)
        expect(descriptor?.enumValues).toEqual(["slack", "email"])
    })

    it("accepts multi-select arrays (string items, optional enum, array-of-strings default)", () => {
        const payload = validPayload()
        const props = payload.requestedSchema.properties as Record<string, unknown>
        props.actions = {
            type: "array",
            title: "Actions",
            items: {type: "string", enum: ["send", "list", "read"]},
            default: ["send"],
        }
        props.repos = {type: "array", title: "Repos", items: {type: "string"}}
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.payload.requestedSchema.properties.actions.default).toEqual(["send"])
    })

    it("accepts oneOf options and canonicalizes their consts into enum (single + items)", () => {
        const payload = validPayload()
        const props = payload.requestedSchema.properties as Record<string, unknown>
        props.process = {
            type: "string",
            oneOf: [
                {const: "merge_main", title: "Merge to main", description: "Daily check"},
                {const: "gh_releases", title: "GitHub releases"},
            ],
        }
        props.channels = {
            type: "array",
            items: {type: "string", oneOf: [{const: "slack"}, {const: "email"}]},
        }
        const result = parseElicitationPayload(payload)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const parsed = result.payload.requestedSchema.properties
        expect(parsed.process.enum).toEqual(["merge_main", "gh_releases"])
        expect(parsed.process.oneOf?.[0]?.description).toBe("Daily check")
        expect(parsed.channels.items?.enum).toEqual(["slack", "email"])
    })

    it("rejects malformed oneOf options", () => {
        const payload = validPayload()
        ;(payload.requestedSchema.properties as Record<string, unknown>).process = {
            type: "string",
            oneOf: [{title: "No const"}],
        }
        expect(parseElicitationPayload(payload)).toEqual({
            ok: false,
            reason: 'property "process" oneOf options need a string const',
        })
        const badItems = validPayload()
        ;(badItems.requestedSchema.properties as Record<string, unknown>).channels = {
            type: "array",
            items: {type: "string", oneOf: [{const: 1}]},
        }
        expect(parseElicitationPayload(badItems).ok).toBe(false)
    })

    it("rejects array fields beyond the multi-select shape", () => {
        const cases: [Record<string, unknown>, string][] = [
            [{type: "array"}, 'property "bad" array items must be strings'],
            [
                {type: "array", items: {type: "number"}},
                'property "bad" array items must be strings',
            ],
            [
                {type: "array", items: {type: "string", items: {type: "string"}}},
                'property "bad" is nested — flat dialect only',
            ],
            [
                {type: "array", items: {type: "string", enum: [1]}},
                'property "bad" items enum must be strings',
            ],
            [
                {type: "array", items: {type: "string"}, default: "send"},
                'property "bad" default must be an array of strings',
            ],
        ]
        for (const [prop, reason] of cases) {
            const payload = validPayload()
            ;(payload.requestedSchema.properties as Record<string, unknown>).bad = prop
            expect(parseElicitationPayload(payload)).toEqual({ok: false, reason})
        }
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

describe("normalizeStringFormat", () => {
    it.each(["date", "date-time", "email", "uri", "multiline"])(
        "passes through canonical format %s",
        (f) => expect(normalizeStringFormat(f)).toBe(f),
    )

    it.each([
        ["textarea", "multiline"],
        ["multi-line", "multiline"],
        ["multi_line", "multiline"],
        ["long-text", "multiline"],
        ["long_text", "multiline"],
        ["longtext", "multiline"],
        ["datetime", "date-time"],
        ["url", "uri"],
    ])("maps alias %s -> %s", (alias, canonical) =>
        expect(normalizeStringFormat(alias)).toBe(canonical),
    )

    it("is case- and whitespace-insensitive", () => {
        expect(normalizeStringFormat("  TextArea ")).toBe("multiline")
        expect(normalizeStringFormat("Date-Time")).toBe("date-time")
    })

    it("returns undefined for unknown or non-string formats", () => {
        expect(normalizeStringFormat("hologram")).toBeUndefined()
        expect(normalizeStringFormat(undefined)).toBeUndefined()
        expect(normalizeStringFormat(42)).toBeUndefined()
    })
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

    it("serializes a date value under an aliased format (parse canonicalizes it first)", () => {
        const result = parseElicitationPayload({
            message: "when?",
            requestedSchema: {
                type: "object",
                properties: {at: {type: "string", format: "datetime"}},
            },
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const iso = "2026-07-06T09:30:00.000Z"
        expect(serializeElicitationContent(result.payload, {at: {toISOString: () => iso}})).toEqual(
            {at: iso},
        )
    })
})

describe("partitionElicitationDraft", () => {
    const payload = {
        message: "m",
        requestedSchema: {
            type: "object" as const,
            properties: {
                due: {type: "string" as const, format: "date"},
                at: {type: "string" as const, format: "date-time"},
                name: {type: "string" as const},
            },
        },
    }

    it("routes ISO strings on date fields to dates (caller revives), the rest to plain", () => {
        const {plain, dates} = partitionElicitationDraft(payload, {
            due: "2026-07-11",
            at: "2026-07-11T09:00:00.000Z",
            name: "Ada",
            ghost: "kept",
        })
        expect(dates).toEqual({due: "2026-07-11", at: "2026-07-11T09:00:00.000Z"})
        expect(plain).toEqual({name: "Ada", ghost: "kept"})
    })

    it("non-string values on date fields stay plain (tolerant)", () => {
        const {plain, dates} = partitionElicitationDraft(payload, {due: 42})
        expect(dates).toEqual({})
        expect(plain).toEqual({due: 42})
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
