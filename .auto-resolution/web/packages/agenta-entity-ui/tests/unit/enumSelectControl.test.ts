/**
 * Unit tests for `getEnumOptions`, the pure schema -> dropdown-options helper behind
 * EnumSelectControl. The agent harness field carries a `oneOf` of `{const, title}` (each option
 * has a display name and a versioned slug identity); this verifies the control reads that shape
 * for labels while still keeping the bare `const` as the written value, and still handles the
 * flat `enum` shape every other consumer uses. Runs under @agenta/entity-ui's vitest runner.
 */
import {describe, expect, it} from "vitest"

import type {SchemaProperty} from "@agenta/entities/shared"

import {getEnumOptions} from "../../src/DrillInView/SchemaControls/EnumSelectControl"

describe("getEnumOptions: flat enum", () => {
    it("maps each enum value to a value/label option", () => {
        const schema = {type: "string", enum: ["local", "daytona"]} as SchemaProperty
        const options = getEnumOptions(schema)
        expect(options.map((o) => o.value)).toEqual(["local", "daytona"])
        // labels come from formatEnumLabel; the value stays the bare string.
        expect(options.every((o) => typeof o.label === "string" && o.label.length > 0)).toBe(true)
    })

    it("returns [] for a schema with no enum and no oneOf", () => {
        expect(getEnumOptions({type: "string"} as SchemaProperty)).toEqual([])
        expect(getEnumOptions(null)).toEqual([])
        expect(getEnumOptions(undefined)).toEqual([])
    })
})

describe("getEnumOptions: oneOf of {const,title} (the agent harness field)", () => {
    const harnessSchema = {
        type: "string",
        enum: ["pi_core", "pi_agenta", "claude"],
        oneOf: [
            {const: "pi_core", title: "Pi", "x-ag-harness-slug": "agenta:harness:pi_core:v0"},
            {
                const: "pi_agenta",
                title: "Pi (Agenta)",
                "x-ag-harness-slug": "agenta:harness:pi_agenta:v0",
            },
            {
                const: "claude",
                title: "Claude Code",
                "x-ag-harness-slug": "agenta:harness:claude:v0",
            },
        ],
    } as unknown as SchemaProperty

    it("uses the bare const as the value and the title as the label", () => {
        const options = getEnumOptions(harnessSchema)
        expect(options).toEqual([
            {value: "pi_core", label: "Pi"},
            {value: "pi_agenta", label: "Pi (Agenta)"},
            {value: "claude", label: "Claude Code"},
        ])
    })

    it("prefers oneOf titles over the flat enum when both are present", () => {
        // The harness schema carries both shapes; the labels must be the display names, not the
        // formatEnumLabel of the bare values.
        const labels = getEnumOptions(harnessSchema).map((o) => o.label)
        expect(labels).toEqual(["Pi", "Pi (Agenta)", "Claude Code"])
    })

    it("falls back to formatEnumLabel when a oneOf entry has no title", () => {
        const schema = {
            type: "string",
            oneOf: [{const: "pi_core"}, {const: "claude", title: "Claude Code"}],
        } as unknown as SchemaProperty
        const options = getEnumOptions(schema)
        expect(options[0].value).toBe("pi_core")
        expect(typeof options[0].label).toBe("string")
        expect(options[1]).toEqual({value: "claude", label: "Claude Code"})
    })
})
