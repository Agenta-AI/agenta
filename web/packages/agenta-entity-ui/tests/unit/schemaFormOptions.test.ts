/**
 * Unit tests for the pure decision logic behind SchemaForm's enum controls (EnumWithOther,
 * MultiEnumWithOther, ChoiceCards) — the state transitions dogfooding is most likely to hit:
 * Other-mode opening for off-options defaults/replays, custom-chip commit/dedupe, single vs
 * multi toggle semantics, and the load-bearing invariant that the OTHER_ENUM_OPTION sentinel
 * never survives into the form value (it would otherwise leak into the accepted elicitation
 * `content` the agent consumes).
 */
import {describe, expect, it} from "vitest"

import type {FormFieldDescriptor} from "@agenta/shared/utils"

import {
    OTHER_ENUM_OPTION,
    commitCustomValue,
    digitKeyIndex,
    enumOptionsOf,
    isOffOptionsValue,
    partitionCustomValues,
    resolveDigitSelection,
    selectOptionsWithOther,
    splitOtherFromSelection,
    toggleCardSelection,
    typeCustomValue,
    wantsChoiceCards,
} from "../../src/gatewayTool/components/schemaFormOptions"

const field = (overrides: Partial<FormFieldDescriptor>): FormFieldDescriptor => ({
    name: "f",
    label: "F",
    type: "enum",
    required: false,
    freeform: false,
    ...overrides,
})

describe("enumOptionsOf", () => {
    it("merges enumValues with oneOf metadata, keeping enumValues order", () => {
        const f = field({
            enumValues: ["b", "a"],
            enumOptions: [{value: "a", label: "A", description: "first"}],
        })
        expect(enumOptionsOf(f)).toEqual([
            {value: "b"},
            {value: "a", label: "A", description: "first"},
        ])
    })

    it("falls back to option values when enumValues is absent", () => {
        const f = field({enumOptions: [{value: "x", label: "X"}]})
        expect(enumOptionsOf(f)).toEqual([{value: "x", label: "X"}])
    })

    it("bare enums produce bare options", () => {
        expect(enumOptionsOf(field({enumValues: ["low", "high"]}))).toEqual([
            {value: "low"},
            {value: "high"},
        ])
    })
})

describe("wantsChoiceCards", () => {
    it("upgrades only when an option carries a description", () => {
        expect(wantsChoiceCards(field({enumOptions: [{value: "a", description: "d"}]}))).toBe(true)
        expect(wantsChoiceCards(field({enumOptions: [{value: "a", label: "A"}]}))).toBe(false)
        expect(wantsChoiceCards(field({enumValues: ["a"]}))).toBe(false)
    })
})

describe("selectOptionsWithOther", () => {
    it("labels fall back to the value and the Other… entry is appended last", () => {
        expect(selectOptionsWithOther([{value: "a"}, {value: "b", label: "B"}])).toEqual([
            {value: "a", label: "a"},
            {value: "b", label: "B"},
            {value: OTHER_ENUM_OPTION, label: "Other…"},
        ])
    })
})

describe("isOffOptionsValue (Other-mode trigger for defaults/replays)", () => {
    const options = [{value: "red"}, {value: "green"}]

    it("true for a set value outside the options (a custom default or replayed draft)", () => {
        expect(isOffOptionsValue("linear", options)).toBe(true)
    })

    it("false for empty values and for listed options", () => {
        expect(isOffOptionsValue(undefined, options)).toBe(false)
        expect(isOffOptionsValue(null, options)).toBe(false)
        expect(isOffOptionsValue("red", options)).toBe(false)
    })

    it("REGRESSION: an empty-string value must not open Other-mode", () => {
        expect(isOffOptionsValue("", options)).toBe(false)
    })
})

describe("splitOtherFromSelection (multi Select onChange)", () => {
    it("strips the sentinel and signals the draft to open", () => {
        expect(splitOtherFromSelection(["a", OTHER_ENUM_OPTION])).toEqual({
            values: ["a"],
            openOther: true,
        })
    })

    it("normalizes empty to undefined so the antd required rule fires", () => {
        expect(splitOtherFromSelection([OTHER_ENUM_OPTION])).toEqual({
            values: undefined,
            openOther: true,
        })
        expect(splitOtherFromSelection([])).toEqual({values: undefined, openOther: false})
    })

    it("INVARIANT: the sentinel never survives into the value", () => {
        const {values} = splitOtherFromSelection([OTHER_ENUM_OPTION, "a", OTHER_ENUM_OPTION])
        expect(values).toEqual(["a"])
    })
})

describe("toggleCardSelection", () => {
    it("single-select replaces the value", () => {
        expect(toggleCardSelection(["a"], "b", false)).toBe("b")
        expect(toggleCardSelection([], "a", false)).toBe("a")
    })

    it("multi toggles membership and empties to undefined", () => {
        expect(toggleCardSelection(["a"], "b", true)).toEqual(["a", "b"])
        expect(toggleCardSelection(["a", "b"], "b", true)).toEqual(["a"])
        expect(toggleCardSelection(["a"], "a", true)).toBeUndefined()
    })
})

describe("commitCustomValue (Other… draft commit)", () => {
    it("single: a trimmed draft becomes the value", () => {
        expect(commitCustomValue([], "  linear ", false)).toEqual({
            changed: true,
            value: "linear",
        })
    })

    it("multi: appends and dedupes against the selection", () => {
        expect(commitCustomValue(["a"], "b", true)).toEqual({changed: true, value: ["a", "b"]})
        expect(commitCustomValue(["a"], "a", true)).toEqual({changed: false, value: ["a"]})
    })

    it("empty or whitespace drafts change nothing", () => {
        expect(commitCustomValue(["a"], "   ", true).changed).toBe(false)
        expect(commitCustomValue([], null, false).changed).toBe(false)
        expect(commitCustomValue([], undefined, true).changed).toBe(false)
    })

    it("INVARIANT: typing the sentinel itself never becomes a value", () => {
        expect(commitCustomValue([], OTHER_ENUM_OPTION, false).changed).toBe(false)
        expect(commitCustomValue(["a"], OTHER_ENUM_OPTION, true).changed).toBe(false)
    })
})

describe("partitionCustomValues", () => {
    it("returns off-options entries in selection order", () => {
        const options = [{value: "a"}, {value: "b"}]
        expect(partitionCustomValues(["x", "a", "y"], options)).toEqual(["x", "y"])
        expect(partitionCustomValues(["a", "b"], options)).toEqual([])
    })
})

describe("typeCustomValue (single-select inline Other input)", () => {
    const options = [{value: "red"}, {value: "green"}]

    it("commits typed text as the value", () => {
        expect(typeCustomValue(undefined, "linear", options)).toEqual({
            changed: true,
            value: "linear",
        })
        expect(typeCustomValue("linea", "linear", options)).toEqual({
            changed: true,
            value: "linear",
        })
    })

    it("re-typing the identical value reports no change", () => {
        expect(typeCustomValue("linear", "linear", options).changed).toBe(false)
    })

    it("clearing the input clears a custom value it owns", () => {
        expect(typeCustomValue("linear", "", options)).toEqual({changed: true, value: undefined})
        expect(typeCustomValue("linear", "   ", options)).toEqual({changed: true, value: undefined})
    })

    it("REGRESSION: clearing the input must not clear a LISTED selection", () => {
        expect(typeCustomValue("red", "", options)).toEqual({changed: false, value: "red"})
        expect(typeCustomValue(undefined, "", options).changed).toBe(false)
    })

    it("INVARIANT: typing the sentinel itself never becomes a value", () => {
        expect(typeCustomValue("red", OTHER_ENUM_OPTION, options)).toEqual({
            changed: false,
            value: "red",
        })
    })
})

describe("digitKeyIndex / resolveDigitSelection (choice-card hotkeys)", () => {
    const options = [{value: "a"}, {value: "b"}, {value: "c"}]

    it("maps 1..9 to indices and rejects everything else", () => {
        expect(digitKeyIndex("1")).toBe(0)
        expect(digitKeyIndex("9")).toBe(8)
        expect(digitKeyIndex("0")).toBeNull()
        expect(digitKeyIndex("a")).toBeNull()
        expect(digitKeyIndex("Enter")).toBeNull()
    })

    it("digits within the option list pick that option", () => {
        expect(resolveDigitSelection("2", options)).toEqual({kind: "option", value: "b"})
    })

    it("the next digit after the options targets the Other tile", () => {
        expect(resolveDigitSelection("4", options)).toEqual({kind: "other"})
    })

    it("digits past the Other tile and non-digits resolve to nothing", () => {
        expect(resolveDigitSelection("5", options)).toBeNull()
        expect(resolveDigitSelection("x", options)).toBeNull()
    })
})
