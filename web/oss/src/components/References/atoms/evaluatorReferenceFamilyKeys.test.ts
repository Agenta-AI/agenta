import {describe, expect, it} from "vitest"

import {evaluatorReferenceAtomFamily, evaluatorWorkflowQueryAtomFamily} from "./entityReferences"

/**
 * `atomFamily` keys its cache by REFERENCE unless it is given an `areEqual`: the lookup is a
 * plain `Map.get(param)`. Both families below are keyed by an object literal that callers
 * rebuild at every call site, so without a comparator the `Map` never hits and each call
 * mints a BRAND NEW atom — a duplicated atom and a duplicated fetch per call site.
 *
 * `evaluatorReferenceAtomFamily` reads `evaluatorWorkflowQueryAtomFamily` from inside its own
 * read function, so a missing comparator also feeds back: each generation mounts its own
 * query observer, the observer emits, and the emit invalidates the reader that created it.
 * Measured, that settles at two atoms, because the query has a 5 minute `staleTime` and no
 * polling. It would run away if anything ever made the query re-emit, which is how the
 * sibling families in `EvalRunDetails` reached React error #185.
 *
 * The list page reaches these through `MetricColumnHeader` -> `useEvaluatorHeaderReference`,
 * one header per evaluator metric column, and through `ReferenceLabels`.
 *
 * These tests assert the property that removes the whole class — an equal-but-not-identical
 * key returns the SAME atom — so a dropped comparator fails here in a second. They only
 * compare atom identity and never read an atom's value, so no query ever runs.
 */

describe("evaluatorWorkflowQueryAtomFamily", () => {
    it("returns the same atom for an equal key built twice", () => {
        const first = evaluatorWorkflowQueryAtomFamily({projectId: "p1", revisionId: "r1"})
        const second = evaluatorWorkflowQueryAtomFamily({projectId: "p1", revisionId: "r1"})

        expect(second).toBe(first)
    })

    it("still separates different keys", () => {
        const a = evaluatorWorkflowQueryAtomFamily({projectId: "p1", revisionId: "r1"})
        const b = evaluatorWorkflowQueryAtomFamily({projectId: "p1", revisionId: "r2"})
        const c = evaluatorWorkflowQueryAtomFamily({projectId: "p2", revisionId: "r1"})

        expect(b).not.toBe(a)
        expect(c).not.toBe(a)
    })

    it("does not grow the cache when the same key is read many times", () => {
        // Call sites build a fresh literal on every read. With a comparator all 50 reads
        // collapse onto one atom; without one this set holds 50 distinct atoms.
        const minted = new Set(
            Array.from({length: 50}, () =>
                evaluatorWorkflowQueryAtomFamily({projectId: "p1", revisionId: "r1"}),
            ),
        )

        expect(minted.size).toBe(1)
    })
})

describe("evaluatorReferenceAtomFamily", () => {
    it("returns the same atom for an equal key built twice", () => {
        const first = evaluatorReferenceAtomFamily({projectId: "p1", slug: "s1", id: "i1"})
        const second = evaluatorReferenceAtomFamily({projectId: "p1", slug: "s1", id: "i1"})

        expect(second).toBe(first)
    })

    it("treats an absent half of the key as equal whether it is null or undefined", () => {
        // `useEvaluatorHeaderReference` passes `undefined`; `ReferenceLabels` passes `null`.
        // They mean the same evaluator, so they must share one atom and one fetch.
        const withUndefined = evaluatorReferenceAtomFamily({
            projectId: "p1",
            slug: undefined,
            id: "i1",
        })
        const withNull = evaluatorReferenceAtomFamily({projectId: "p1", slug: null, id: "i1"})
        const omitted = evaluatorReferenceAtomFamily({projectId: "p1", id: "i1"})

        expect(withNull).toBe(withUndefined)
        expect(omitted).toBe(withUndefined)
    })

    it("still separates different evaluators", () => {
        const a = evaluatorReferenceAtomFamily({projectId: "p1", id: "i1"})
        const b = evaluatorReferenceAtomFamily({projectId: "p1", id: "i2"})
        const c = evaluatorReferenceAtomFamily({projectId: "p1", slug: "s1"})

        expect(b).not.toBe(a)
        expect(c).not.toBe(a)
    })
})
