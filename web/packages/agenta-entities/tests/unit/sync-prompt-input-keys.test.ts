/**
 * Unit tests for `syncPromptInputKeysInParameters` — the function that
 * recomputes a prompt config's `input_keys` at commit/save time.
 *
 * The critical contract (Mahmoud QA 2026-06-03): `input_keys` must be the
 * set of TOP-LEVEL keys the runtime `inputs` dict is keyed by, NOT the raw
 * scoped/dotted placeholder paths. For mustache `{{country.name}}` →
 * `input_keys: ["country"]`; for curly `{{user.name}}` → `["user.name"]`
 * (literal column per the backend literal-key resolver).
 */
import {describe, expect, it} from "vitest"

import {syncPromptInputKeysInParameters} from "../../src/runnable/utils"

const promptParams = (content: string, template_format: string) => ({
    prompt: {
        messages: [
            {role: "system", content: "You are an expert in geography"},
            {role: "user", content},
        ],
        template_format,
        llm_config: {model: "gpt-4o-mini"},
    },
})

const inputKeysOf = (params: Record<string, unknown>): unknown => {
    const synced = syncPromptInputKeysInParameters(params) as Record<string, unknown>
    return (synced.prompt as Record<string, unknown>).input_keys
}

describe("syncPromptInputKeysInParameters", () => {
    describe("mustache — top-level keys", () => {
        it("collapses dotted access to its top-level key", () => {
            // Mahmoud's exact repro: `{{country.name}}` + `{{ab.b}}` must
            // save `["country", "ab"]`, NOT `["country.name", "ab.b"]`.
            const params = promptParams(
                "What is the capital of {{country.name}}? {{ab.b}}",
                "mustache",
            )
            expect(inputKeysOf(params)).toEqual(["country", "ab"])
        })

        it("keeps plain top-level variables as-is", () => {
            const params = promptParams("Hello {{name}} in {{place}}", "mustache")
            expect(inputKeysOf(params)).toEqual(["name", "place"])
        })

        it("collapses a section opener to its name", () => {
            const params = promptParams("{{#repos}}{{name}} ({{stars}}){{/repos}}", "mustache")
            expect(inputKeysOf(params)).toEqual(["repos"])
        })

        it("collapses nested sections + dotted access to top-level keys", () => {
            const params = promptParams(
                "{{#repos}}{{name}}{{#contributors}}{{name}}{{/contributors}}{{/repos}}{{country.x}}",
                "mustache",
            )
            expect(inputKeysOf(params)).toEqual(["repos", "country"])
        })

        it("dedups when a name appears both plain and dotted", () => {
            const params = promptParams("{{geo}} then {{geo.region}}", "mustache")
            expect(inputKeysOf(params)).toEqual(["geo"])
        })

        it("excludes JSONPath envelope refs that aren't inputs", () => {
            // `$.outputs.score` is an outputs-envelope ref — runtime
            // resolved, never an input key. `{{topic}}` is the only input.
            const params = promptParams("{{topic}} — score {{$.outputs.score}}", "mustache")
            expect(inputKeysOf(params)).toEqual(["topic"])
        })

        it("maps a JSONPath inputs ref to its top-level key", () => {
            const params = promptParams("{{$.inputs.country.name}}", "mustache")
            expect(inputKeysOf(params)).toEqual(["country"])
        })
    })

    describe("curly — literal dotted keys (no regression)", () => {
        it("keeps dotted names verbatim (literal testcase column)", () => {
            const params = promptParams("Hi {{user.name}} from {{user.city}}", "curly")
            expect(inputKeysOf(params)).toEqual(["user.name", "user.city"])
        })

        it("keeps plain variables", () => {
            const params = promptParams("Hello {{name}}", "curly")
            expect(inputKeysOf(params)).toEqual(["name"])
        })
    })

    describe("jinja2 — nested semantics like mustache", () => {
        it("collapses dotted attribute access to top-level", () => {
            const params = promptParams("{{geo.region}} and {{geo.city}}", "jinja2")
            expect(inputKeysOf(params)).toEqual(["geo"])
        })
    })

    describe("structural behaviour", () => {
        it("supports the ag_config wrapper", () => {
            const wrapped = {ag_config: promptParams("{{country.name}}", "mustache")}
            const synced = syncPromptInputKeysInParameters(wrapped) as Record<string, unknown>
            const agConfig = synced.ag_config as Record<string, unknown>
            const prompt = agConfig.prompt as Record<string, unknown>
            expect(prompt.input_keys).toEqual(["country"])
        })

        it("returns the same object reference when nothing changed", () => {
            const params = promptParams("Hello {{name}}", "mustache")
            // Pre-seed the already-correct input_keys.
            ;(params.prompt as Record<string, unknown>).input_keys = ["name"]
            const synced = syncPromptInputKeysInParameters(params)
            expect(synced).toBe(params)
        })

        it("ignores non-prompt config entries (no messages array)", () => {
            const params = {
                prompt: promptParams("{{country.name}}", "mustache").prompt,
                some_other_config: {threshold: 0.5},
            }
            const synced = syncPromptInputKeysInParameters(params) as Record<string, unknown>
            const prompt = synced.prompt as Record<string, unknown>
            expect(prompt.input_keys).toEqual(["country"])
            // The non-prompt entry is untouched.
            expect(synced.some_other_config).toEqual({threshold: 0.5})
        })

        it("returns null/undefined inputs unchanged", () => {
            expect(syncPromptInputKeysInParameters(null)).toBeNull()
            expect(syncPromptInputKeysInParameters(undefined)).toBeUndefined()
        })
    })
})
