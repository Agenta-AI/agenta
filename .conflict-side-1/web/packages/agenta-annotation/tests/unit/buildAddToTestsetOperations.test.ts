import {describe, expect, it} from "vitest"

import {buildAddToTestsetOperations} from "../../src/state/testsetSync"

describe("buildAddToTestsetOperations", () => {
    it("replaces rows that came from the target testset instead of appending them", () => {
        // Regression for AGE-3761: exporting annotated testcases back to their
        // own testset previously used `add`, duplicating every testcase (once
        // unannotated, once annotated). They must `replace` the source rows.
        const baseRows = [
            {id: "tc-1", data: {question: "a"}},
            {id: "tc-2", data: {question: "b"}},
        ]

        const operations = buildAddToTestsetOperations({
            rows: [
                {rowId: "tc-1", data: {question: "a", score: 5}},
                {rowId: "tc-2", data: {question: "b", score: 3}},
            ],
            baseRows,
        })

        expect(operations.rows?.replace).toEqual([
            {id: "tc-1", data: {question: "a", score: 5}},
            {id: "tc-2", data: {question: "b", score: 3}},
        ])
        expect(operations.rows?.add).toBeUndefined()
    })

    it("adds rows that do not correspond to an existing base row (e.g. trace exports)", () => {
        const operations = buildAddToTestsetOperations({
            rows: [
                {rowId: null, data: {input: "x", output: "y"}},
                {rowId: undefined, data: {input: "z", output: "w"}},
            ],
            baseRows: [{id: "tc-1", data: {input: "existing"}}],
        })

        expect(operations.rows?.add).toEqual([
            {data: {input: "x", output: "y"}},
            {data: {input: "z", output: "w"}},
        ])
        expect(operations.rows?.replace).toBeUndefined()
    })

    it("falls back to the dedup id when the source row id is absent from the base revision", () => {
        const operations = buildAddToTestsetOperations({
            rows: [
                {
                    rowId: "stale-id",
                    dedupId: "dedup-42",
                    data: {question: "a", score: 5},
                },
            ],
            baseRows: [{id: "tc-current", data: {question: "a", testcase_dedup_id: "dedup-42"}}],
        })

        expect(operations.rows?.replace).toEqual([
            {id: "tc-current", data: {question: "a", score: 5}},
        ])
        expect(operations.rows?.add).toBeUndefined()
    })

    it("mixes replace and add when only some rows match the base revision", () => {
        const operations = buildAddToTestsetOperations({
            rows: [
                {rowId: "tc-1", data: {question: "a", score: 5}},
                {rowId: null, data: {question: "new", score: 1}},
            ],
            baseRows: [{id: "tc-1", data: {question: "a"}}],
        })

        expect(operations.rows?.replace).toEqual([{id: "tc-1", data: {question: "a", score: 5}}])
        expect(operations.rows?.add).toEqual([{data: {question: "new", score: 1}}])
    })

    // Regression for the "second update duplicates the first testcase" repro:
    // step 1 replaces testcase#1, and because testcases are immutable the
    // backend assigns it a NEW id (here "tc-new"). The annotation queue still
    // references the ORIGINAL id ("tc-old"). On the second update the stale id
    // no longer exists in the revision, so the match MUST fall back to the
    // dedup id — which only works because the step-1 replace preserved
    // `testcase_dedup_id`. Without dedup preservation this row would `add` and
    // duplicate.
    it("re-matches via dedup id after a prior replace reassigned the testcase id", () => {
        const operations = buildAddToTestsetOperations({
            rows: [{rowId: "tc-old", dedupId: "D1", data: {country: "Nauru", "quality-rating": 5}}],
            baseRows: [
                {id: "tc-new", data: {country: "Nauru", testcase_dedup_id: "D1"}},
                {id: "tc-2", data: {country: "Tuvalu", testcase_dedup_id: "D2"}},
            ],
        })

        expect(operations.rows?.replace).toEqual([
            {id: "tc-new", data: {country: "Nauru", "quality-rating": 5}},
        ])
        expect(operations.rows?.add).toBeUndefined()
    })

    // Idempotency (criteria B1): re-saving with nothing changed must produce an
    // empty delta — no replace, no add — so the backend creates no new revision
    // and doesn't churn testcase ids.
    it("skips a matched row whose data already equals the base row", () => {
        const data = {country: "Nauru", "quality-rating": 5, testcase_dedup_id: "D1"}
        const operations = buildAddToTestsetOperations({
            rows: [{rowId: "tc-1", dedupId: "D1", data}],
            // base row holds the same data (key order differs — must still skip)
            baseRows: [
                {
                    id: "tc-1",
                    data: {testcase_dedup_id: "D1", "quality-rating": 5, country: "Nauru"},
                },
            ],
        })

        expect(operations.rows?.replace).toBeUndefined()
        expect(operations.rows?.add).toBeUndefined()
    })

    it("replaces only the rows whose annotation actually changed", () => {
        const operations = buildAddToTestsetOperations({
            rows: [
                {rowId: "tc-1", data: {country: "Nauru", rating: "good"}}, // unchanged
                {rowId: "tc-2", data: {country: "Tuvalu", rating: "bad"}}, // changed
            ],
            baseRows: [
                {id: "tc-1", data: {country: "Nauru", rating: "good"}},
                {id: "tc-2", data: {country: "Tuvalu", rating: "good"}},
            ],
        })

        expect(operations.rows?.replace).toEqual([
            {id: "tc-2", data: {country: "Tuvalu", rating: "bad"}},
        ])
        expect(operations.rows?.add).toBeUndefined()
    })

    // Corruption guard: when the target revision has duplicate
    // testcase_dedup_ids (dedup -> row is no longer 1:1), a row matchable only
    // by that dedup must NOT replace an arbitrary row — it falls through to add.
    // An id match still wins (it's unambiguous).
    it("does not replace via an ambiguous (duplicated) dedup id", () => {
        const operations = buildAddToTestsetOperations({
            rows: [
                // only matchable by the duplicated dedup -> must add, not replace
                {rowId: "stale", dedupId: "DUP", data: {country: "Nauru", rating: 5}},
                // unambiguous id match -> still replaces in place
                {rowId: "tc-3", data: {country: "Palau", rating: 4}},
            ],
            baseRows: [
                {id: "tc-1", data: {country: "Nauru", testcase_dedup_id: "DUP"}},
                {id: "tc-2", data: {country: "NauruDup", testcase_dedup_id: "DUP"}},
                {id: "tc-3", data: {country: "Palau", testcase_dedup_id: "D3"}},
            ],
        })

        expect(operations.rows?.add).toEqual([{data: {country: "Nauru", rating: 5}}])
        expect(operations.rows?.replace).toEqual([
            {id: "tc-3", data: {country: "Palau", rating: 4}},
        ])
    })
})
