import {describe, expect, it} from "vitest"

import {mergeReferenceChips, testcaseChipLabel} from "../../src/references/mergeReferenceChips"

describe("mergeReferenceChips", () => {
    it("merges an application given by workflow keys into one chip", () => {
        const chips = mergeReferenceChips([
            {key: "workflow", id: "app-1", slug: "lead_scorer"},
            {key: "workflow_variant", id: "var-1", slug: "with_site_text"},
            {key: "workflow_revision", id: "rev-1", version: 8},
        ])
        expect(chips).toEqual([
            {
                kind: "app",
                entity: {id: "app-1", slug: "lead_scorer", version: null},
                variant: {id: "var-1", slug: "with_site_text", version: null},
                revision: {id: "rev-1", slug: null, version: "8"},
                testcase: null,
            },
        ])
    })

    it("keeps one chip per entity in a fixed order: application, environment, evaluator, test case", () => {
        const chips = mergeReferenceChips([
            {key: "testcase", id: "7f3a1c90-aaaa"},
            {key: "evaluator", id: "ev-1", slug: "faithfulness-judge"},
            {key: "evaluator_revision", id: "ev-rev", version: "3"},
            {key: "environment", slug: "production"},
            {key: "application", id: "app-1"},
            {key: "testset", id: "ts-1", slug: "support-faq"},
            {key: "testset_revision", id: "ts-rev", version: 4},
        ])
        expect(chips.map((chip) => chip.kind)).toEqual([
            "app",
            "environment",
            "evaluator",
            "testcase",
        ])
        const testcase = chips[3]
        expect(testcase.entity).toEqual({id: "ts-1", slug: "support-faq", version: null})
        expect(testcase.revision).toEqual({id: "ts-rev", slug: null, version: "4"})
        expect(testcase.testcase).toEqual({id: "7f3a1c90-aaaa", slug: null, version: null})
        expect(chips[2].revision?.version).toBe("3")
    })

    it("names a test set with no test case a test set chip", () => {
        expect(mergeReferenceChips([{key: "testset", id: "ts-1"}])[0].kind).toBe("testset")
    })

    it("gives no chip when there are no references", () => {
        expect(mergeReferenceChips([])).toEqual([])
        expect(mergeReferenceChips(null)).toEqual([])
    })

    it("leaves out a field with no id and no slug, and a key it does not know", () => {
        expect(
            mergeReferenceChips([
                {key: "application", id: null, slug: ""},
                {key: "query", id: "q-1"},
            ]),
        ).toEqual([])
        const chips = mergeReferenceChips([
            {key: "application_variant", id: null},
            {key: "application", slug: "lead_scorer"},
        ])
        expect(chips).toHaveLength(1)
        expect(chips[0].variant).toBeNull()
    })
})

describe("testcaseChipLabel", () => {
    it("joins the test set name and the first 6 characters of the test case id", () => {
        expect(testcaseChipLabel("support-faq", "7f3a1c90-1234")).toBe("support-faq / 7f3a1c")
    })
})
