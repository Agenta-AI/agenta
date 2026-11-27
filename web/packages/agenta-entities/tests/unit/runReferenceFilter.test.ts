/**
 * Run-list reference predicate — the run-level counterpart to the scenario-row
 * predicate. Covers role resolution off `step.references` (the role-keyed
 * primary path + the step.type legacy fallback), the subject/grader
 * distinction (`isSubjectRun`), the `hasResolvableSubject` safety guard, and
 * the `eq`/`ne` ops.
 */

import {describe, expect, it} from "vitest"

import {
    collectRoleReferenceKeys,
    evaluateRunReferencePredicate,
    hasResolvableSubject,
    isSubjectRun,
    type RunReferenceStep,
} from "../../src/evaluationRun/etl/runReferenceFilter"

const EVALUATOR = "eval-with-reasoning"
const APP = "app-comp-1"
const GRADER = "eval-grader-x"

/** A grader run: app `app-comp-1` graded by evaluator `eval-with-reasoning`. */
const graderRun: RunReferenceStep[] = [
    {type: "input", references: {testset: {id: "ts-1"}}},
    {type: "invocation", references: {application: {id: APP}}},
    {type: "annotation", references: {evaluator: {id: EVALUATOR, slug: "with-reasoning"}}},
]

/** A subject run: an evaluation run ON `eval-with-reasoning` (the #4237 feature). */
const subjectRun: RunReferenceStep[] = [
    {type: "input", references: {testset: {id: "ts-2"}}},
    {type: "invocation", references: {application: {id: EVALUATOR}}},
    {type: "annotation", references: {evaluator: {id: GRADER}}},
]

describe("collectRoleReferenceKeys", () => {
    it("reads role-keyed references off each step", () => {
        expect([...collectRoleReferenceKeys(graderRun, "application")]).toEqual([APP])
        expect([...collectRoleReferenceKeys(graderRun, "evaluator")].sort()).toEqual(
            [EVALUATOR, "with-reasoning"].sort(),
        )
        expect([...collectRoleReferenceKeys(graderRun, "testset")]).toEqual(["ts-1"])
    })

    it("includes both id and slug so evaluators match either", () => {
        const keys = collectRoleReferenceKeys(graderRun, "evaluator")
        expect(keys.has(EVALUATOR)).toBeTruthy()
        expect(keys.has("with-reasoning")).toBeTruthy()
    })

    it("returns empty for missing/empty steps", () => {
        expect(collectRoleReferenceKeys(null, "application").size).toBe(0)
        expect(collectRoleReferenceKeys(undefined, "application").size).toBe(0)
        expect(collectRoleReferenceKeys([], "application").size).toBe(0)
        expect(collectRoleReferenceKeys([{type: "invocation"}], "application").size).toBe(0)
    })

    it("falls back to step.type for a legacy single-reference step", () => {
        const legacy: RunReferenceStep[] = [{type: "invocation", references: {ref: {id: APP}}}]
        expect([...collectRoleReferenceKeys(legacy, "application")]).toEqual([APP])
    })

    it("does NOT use the legacy fallback when multiple references are present (avoids over-match)", () => {
        const ambiguous: RunReferenceStep[] = [
            {type: "invocation", references: {ref: {id: APP}, other: {id: "x"}}},
        ]
        expect(collectRoleReferenceKeys(ambiguous, "application").size).toBe(0)
    })
})

describe("isSubjectRun / grader distinction", () => {
    it("subject run: the evaluator is the application/subject", () => {
        expect(isSubjectRun(subjectRun, EVALUATOR)).toBe(true)
    })

    it("grader run: the evaluator is NOT the subject (it's an annotation)", () => {
        expect(isSubjectRun(graderRun, EVALUATOR)).toBe(false)
    })

    it("the app IS the subject of its own grader run", () => {
        expect(isSubjectRun(graderRun, APP)).toBe(true)
    })
})

describe("evaluateRunReferencePredicate ops", () => {
    it("eq matches the role's id", () => {
        expect(evaluateRunReferencePredicate({role: "evaluator", id: EVALUATOR}, graderRun)).toBe(
            true,
        )
    })

    it("ne is the complement", () => {
        expect(
            evaluateRunReferencePredicate(
                {role: "application", id: EVALUATOR, op: "ne"},
                graderRun,
            ),
        ).toBe(true)
        expect(
            evaluateRunReferencePredicate(
                {role: "application", id: EVALUATOR, op: "ne"},
                subjectRun,
            ),
        ).toBe(false)
    })

    it("matches an evaluator by slug too", () => {
        expect(
            evaluateRunReferencePredicate({role: "evaluator", id: "with-reasoning"}, graderRun),
        ).toBe(true)
    })
})

describe("hasResolvableSubject", () => {
    it("true when an application reference exists", () => {
        expect(hasResolvableSubject(graderRun)).toBe(true)
        expect(hasResolvableSubject(subjectRun)).toBe(true)
    })

    it("false when no application reference can be resolved", () => {
        expect(
            hasResolvableSubject([{type: "annotation", references: {evaluator: {id: EVALUATOR}}}]),
        ).toBe(false)
        expect(hasResolvableSubject([])).toBe(false)
        expect(hasResolvableSubject(null)).toBe(false)
    })
})
