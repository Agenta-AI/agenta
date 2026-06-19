/**
 * Unit tests for the pure inputs-visibility split rule.
 *
 * Covers the referenced/unreferenced split. Draft badges are applied later
 * by callers for states unrelated to missing prompt-variable testcase data.
 */
import {describe, expect, it} from "vitest"

import {
    filterUnreferencedColumnsForSource,
    splitInputsVisibility,
} from "../../src/state/execution/visibility"

describe("splitInputsVisibility", () => {
    describe("missing keys", () => {
        it("keeps referenced keys absent from testcase as inputs without draft state", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["name", "geo"],
                testcaseData: {},
            })
            expect(inputs).toEqual([
                {name: "name", value: undefined},
                {name: "geo", value: undefined},
            ])
        })

        it("preserves ordering from referencedKeys", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["c", "a", "b"],
                testcaseData: {a: "x"},
            })
            expect(inputs.map((i) => i.name)).toEqual(["c", "a", "b"])
        })

        it("marks only newly added uncommitted prompt variables as draft", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["committed", "newVariable"],
                draftKeys: ["newVariable"],
                testcaseData: {},
            })

            expect(inputs).toEqual([
                {name: "committed", value: undefined},
                {name: "newVariable", value: undefined, isDraft: true},
            ])
        })

        it("keeps a new uncommitted variable draft after testcase data is entered", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["newVariable"],
                draftKeys: ["newVariable"],
                testcaseData: {newVariable: "authored value"},
            })

            expect(inputs).toEqual([{name: "newVariable", value: "authored value", isDraft: true}])
        })

        it("does not infer draft state when no committed baseline is available", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["newWorkflowVariable"],
                testcaseData: {},
            })

            expect(inputs).toEqual([{name: "newWorkflowVariable", value: undefined}])
        })
    })

    describe("non-empty values (not draft)", () => {
        it("string", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["a"],
                testcaseData: {a: "hello"},
            })
            expect(inputs).toEqual([{name: "a", value: "hello"}])
        })

        it("number including 0", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["a", "b"],
                testcaseData: {a: 0, b: 42},
            })
            expect(inputs).toEqual([
                {name: "a", value: 0},
                {name: "b", value: 42},
            ])
        })

        it("boolean including false", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["a", "b"],
                testcaseData: {a: false, b: true},
            })
            expect(inputs).toEqual([
                {name: "a", value: false},
                {name: "b", value: true},
            ])
        })

        it("non-empty object", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["g"],
                testcaseData: {g: {region: "EU"}},
            })
            expect(inputs).toEqual([{name: "g", value: {region: "EU"}}])
        })

        it("non-empty array", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["r"],
                testcaseData: {r: [1, 2]},
            })
            expect(inputs).toEqual([{name: "r", value: [1, 2]}])
        })
    })

    describe("primitives stay authored (existing contract)", () => {
        // If the key is present in the testcase data, the value is authored.
        // Empty/cleared values should not carry the draft badge.
        it("treats null as authored", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["a"],
                testcaseData: {a: null},
            })
            expect(inputs).toEqual([{name: "a", value: null}])
        })

        it("treats explicit undefined as authored", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["a"],
                testcaseData: {a: undefined},
            })
            expect(inputs).toEqual([{name: "a", value: undefined}])
        })

        it("treats empty string as authored", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["a"],
                testcaseData: {a: ""},
            })
            expect(inputs).toEqual([{name: "a", value: ""}])
        })
    })

    describe("empty containers stay authored", () => {
        it("treats empty object {} as authored when the key exists", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["geo", "repos"],
                testcaseData: {geo: {}, repos: {}},
            })
            expect(inputs).toEqual([
                {name: "geo", value: {}},
                {name: "repos", value: {}},
            ])
        })

        it("treats empty array [] as authored when the key exists", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["items"],
                testcaseData: {items: []},
            })
            expect(inputs).toEqual([{name: "items", value: []}])
        })

        it("does not propagate isDraft beyond top level (deep emptiness ignored)", () => {
            // An object with at least one key is NOT draft, even if the
            // nested values are themselves empty. Drilling deeper is the
            // FormView's job; the visibility rule only judges the root.
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["g"],
                testcaseData: {g: {region: ""}},
            })
            expect(inputs).toEqual([{name: "g", value: {region: ""}}])
        })
    })

    describe("unreferenced columns", () => {
        it("collects testcase keys not referenced by prompt", () => {
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: ["a"],
                testcaseData: {a: "x", b: "y", c: "z"},
            })
            expect(unreferencedColumns).toEqual([
                {name: "b", value: "y"},
                {name: "c", value: "z"},
            ])
        })

        it("preserves testcase iteration order", () => {
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {z: 1, a: 2, m: 3},
            })
            expect(unreferencedColumns.map((c) => c.name)).toEqual(["z", "a", "m"])
        })

        it("includes empty values in unreferenced too — they belong to the user", () => {
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {old: "", deprecated: {}},
            })
            expect(unreferencedColumns).toEqual([
                {name: "old", value: ""},
                {name: "deprecated", value: {}},
            ])
        })

        it("hides unreferenced columns for local unsynced playground rows", () => {
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {removedPromptVariable: "draft text"},
            })

            expect(filterUnreferencedColumnsForSource(unreferencedColumns, null)).toEqual([])
        })

        it("keeps unreferenced columns visible for connected testset rows", () => {
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: ["prompt"],
                testcaseData: {prompt: "hello", expected: "world"},
            })

            expect(
                filterUnreferencedColumnsForSource(unreferencedColumns, "testset-rev-1"),
            ).toEqual([{name: "expected", value: "world"}])
        })
    })

    describe("test set columns missing from the row", () => {
        it("appends missing test set columns as empty fields after the row's own", () => {
            // A draft row kept through "Keep and load" carries only its own
            // keys; the test set's extra columns must still render so the
            // user can fill them in the grid, not just the drawer.
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: ["prompt"],
                testcaseData: {prompt: "hello", notes: "draft"},
                testsetColumnKeys: ["expected_output", "context"],
            })
            expect(unreferencedColumns).toEqual([
                {name: "notes", value: "draft"},
                {name: "expected_output", value: undefined},
                {name: "context", value: undefined},
            ])
        })

        it("does not duplicate columns the row already carries", () => {
            const {unreferencedColumns} = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {expected_output: "42"},
                testsetColumnKeys: ["expected_output"],
            })
            expect(unreferencedColumns).toEqual([{name: "expected_output", value: "42"}])
        })

        it("leaves referenced test set columns to the inputs cards", () => {
            const {inputs, unreferencedColumns} = splitInputsVisibility({
                referencedKeys: ["country"],
                testcaseData: {},
                testsetColumnKeys: ["country", "expected_output"],
            })
            expect(inputs).toEqual([{name: "country", value: undefined}])
            expect(unreferencedColumns).toEqual([{name: "expected_output", value: undefined}])
        })
    })
})
