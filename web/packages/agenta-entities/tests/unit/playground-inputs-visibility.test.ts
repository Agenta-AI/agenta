/**
 * Unit tests for the pure `splitInputsVisibility` rule that powers Step 4
 * of the playground mustache + input UX branch.
 *
 * Same stopgap-location reasoning as the other Step-2/3 tests: vitest lives
 * in agenta-entities; the helper lives in @agenta/playground (the
 * package's own test runner is a follow-up). Cross-package relative import
 * below is a test-time dep only.
 *
 * TODO(follow-up): Move alongside the helper once @agenta/playground gets
 * its own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    filterUnreferencedColumnsForSource,
    splitInputsVisibility,
} from "../../../agenta-playground/src/state/execution/visibility"

describe("splitInputsVisibility — referenced vs unreferenced", () => {
    describe("referenced + testcase intersection", () => {
        it("returns inputs in referencedKeys order with their testcase values", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["country", "geo", "messages"],
                testcaseData: {
                    geo: {region: "Pacific"},
                    messages: [{role: "user", content: "hi"}],
                    country: "Vanuatu",
                },
            })

            expect(result.inputs.map((i) => i.name)).toEqual(["country", "geo", "messages"])
            expect(result.inputs[0].value).toBe("Vanuatu")
            expect(result.inputs[1].value).toEqual({region: "Pacific"})
            expect(result.inputs[2].value).toEqual([{role: "user", content: "hi"}])
            expect(result.inputs.every((i) => !i.isDraft)).toBe(true)
        })

        it("preserves native object/array values by reference (no clone, no stringify)", () => {
            const geo = {region: "Pacific"}
            const result = splitInputsVisibility({
                referencedKeys: ["geo"],
                testcaseData: {geo},
            })
            expect(result.inputs[0].value).toBe(geo)
        })
    })

    describe("referenced variables absent from testcase", () => {
        it("keeps referenced names missing from testcase as plain inputs", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["country", "iso_code"],
                testcaseData: {country: "Vanuatu"},
            })

            expect(result.inputs).toEqual([
                {name: "country", value: "Vanuatu"},
                {name: "iso_code", value: undefined},
            ])
        })

        it("keeps missing input order with referenced order (no reshuffling)", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["a", "b", "c"],
                testcaseData: {b: 2},
            })
            expect(result.inputs.map((i) => `${i.name}:${i.isDraft ?? false}`)).toEqual([
                "a:false",
                "b:false",
                "c:false",
            ])
        })

        it("marks only keys supplied by the uncommitted workflow delta as draft", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["committed", "newVariable"],
                draftKeys: ["newVariable"],
                testcaseData: {newVariable: "typed"},
            })

            expect(result.inputs).toEqual([
                {name: "committed", value: undefined},
                {name: "newVariable", value: "typed", isDraft: true},
            ])
        })

        it("treats a key present with a null value as NOT draft (null is a real value)", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["x"],
                testcaseData: {x: null},
            })
            expect(result.inputs[0]).toEqual({name: "x", value: null})
            expect(result.inputs[0].isDraft).toBeUndefined()
        })

        it("treats a key present with `undefined` as NOT draft (it's authored)", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["x"],
                testcaseData: {x: undefined},
            })
            expect(result.inputs[0]).toEqual({name: "x", value: undefined})
            expect(result.inputs[0].isDraft).toBeUndefined()
        })

        it("treats a key present with empty containers as NOT draft", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["geo", "items"],
                testcaseData: {geo: {}, items: []},
            })
            expect(result.inputs).toEqual([
                {name: "geo", value: {}},
                {name: "items", value: []},
            ])
            expect(result.inputs.every((i) => !i.isDraft)).toBe(true)
        })
    })

    describe("unreferenced columns", () => {
        it("collects testcase columns not in referenced", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["country"],
                testcaseData: {country: "Vanuatu", population: 320, notes: "n/a"},
            })

            expect(result.unreferencedColumns).toEqual([
                {name: "population", value: 320},
                {name: "notes", value: "n/a"},
            ])
        })

        it("preserves native value types in unreferenced (no stringify)", () => {
            const profile = {name: "Ada"}
            const result = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {profile, tags: ["a", "b"]},
            })

            expect(result.unreferencedColumns[0].value).toBe(profile)
            expect(result.unreferencedColumns[1].value).toEqual(["a", "b"])
        })

        it("returns empty unreferenced when every testcase key is referenced", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["a", "b"],
                testcaseData: {a: 1, b: 2},
            })
            expect(result.unreferencedColumns).toEqual([])
        })

        it("hides unreferenced columns for local unsynced playground rows", () => {
            const result = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {removedPromptVariable: "draft text"},
            })

            expect(filterUnreferencedColumnsForSource(result.unreferencedColumns, null)).toEqual([])
        })

        it("keeps unreferenced columns visible for connected testset rows", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["prompt"],
                testcaseData: {prompt: "hello", expected: "world"},
            })

            expect(
                filterUnreferencedColumnsForSource(result.unreferencedColumns, "testset-rev-1"),
            ).toEqual([{name: "expected", value: "world"}])
        })
    })

    describe("edge cases", () => {
        it("empty referenced + empty testcase → empty result", () => {
            expect(splitInputsVisibility({referencedKeys: [], testcaseData: {}})).toEqual({
                inputs: [],
                unreferencedColumns: [],
            })
        })

        it("empty referenced + non-empty testcase → all rows go to unreferenced", () => {
            const result = splitInputsVisibility({
                referencedKeys: [],
                testcaseData: {a: 1, b: 2},
            })
            expect(result.inputs).toEqual([])
            expect(result.unreferencedColumns).toEqual([
                {name: "a", value: 1},
                {name: "b", value: 2},
            ])
        })

        it("non-empty referenced + empty testcase → all referenced are plain missing inputs", () => {
            const result = splitInputsVisibility({
                referencedKeys: ["x", "y"],
                testcaseData: {},
            })
            expect(result.inputs).toEqual([
                {name: "x", value: undefined},
                {name: "y", value: undefined},
            ])
            expect(result.unreferencedColumns).toEqual([])
        })

        it("does NOT mutate the inputs (referenced list and testcase data are untouched)", () => {
            const refs = ["a", "b"]
            const data = {a: 1, c: 3}
            splitInputsVisibility({referencedKeys: refs, testcaseData: data})
            expect(refs).toEqual(["a", "b"])
            expect(data).toEqual({a: 1, c: 3})
        })
    })
})
