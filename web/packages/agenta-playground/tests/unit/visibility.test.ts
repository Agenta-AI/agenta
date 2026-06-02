/**
 * Unit tests for the pure inputs-visibility split rule.
 *
 * Covers the draft-annotation behaviour: any referenced key whose value
 * is unauthored — missing OR empty — surfaces with `isDraft: true`.
 */
import {describe, expect, it} from "vitest"

import {splitInputsVisibility} from "../../src/state/execution/visibility"

describe("splitInputsVisibility", () => {
    describe("missing keys", () => {
        it("marks referenced keys absent from testcase as draft", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["name", "geo"],
                testcaseData: {},
            })
            expect(inputs).toEqual([
                {name: "name", value: undefined, isDraft: true},
                {name: "geo", value: undefined, isDraft: true},
            ])
        })

        it("preserves ordering from referencedKeys", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["c", "a", "b"],
                testcaseData: {a: "x"},
            })
            expect(inputs.map((i) => i.name)).toEqual(["c", "a", "b"])
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
        // The pre-existing `playground-inputs-visibility.test.ts` contract:
        // primitives — `null`, `undefined`, `""`, `0`, `false` — are
        // treated as authored when the key is present. Only EMPTY
        // CONTAINERS (the auto-seed case for object / array ports) are
        // re-classified as draft in this rule. Keeping the primitives
        // strict avoids a regression in the "user has explicitly cleared
        // a string field" UX.
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

    describe("empty containers (draft) — Arda QA 2026-06-02", () => {
        it("treats empty object {} as draft (the geo/repos auto-seed case)", () => {
            // Object-typed ports get auto-seeded with `{}` when the
            // testcase column is created. Previously the `in` check
            // marked these as authored — inconsistent with string ports
            // that stay missing. Now both render with the draft badge
            // until the user actually fills a sub-field.
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["geo", "repos"],
                testcaseData: {geo: {}, repos: {}},
            })
            expect(inputs).toEqual([
                {name: "geo", value: {}, isDraft: true},
                {name: "repos", value: {}, isDraft: true},
            ])
        })

        it("treats empty array [] as draft", () => {
            const {inputs} = splitInputsVisibility({
                referencedKeys: ["items"],
                testcaseData: {items: []},
            })
            expect(inputs).toEqual([{name: "items", value: [], isDraft: true}])
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
    })
})
