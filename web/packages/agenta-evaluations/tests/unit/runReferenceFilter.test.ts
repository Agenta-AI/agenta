/**
 * Run-list reference predicate — the run-level counterpart to the scenario-row
 * predicate. Covers role resolution off `step.references` (the role-keyed
 * primary path + the step.type legacy fallback), the subject/grader
 * distinction (`isSubjectRun`), the `hasResolvableSubject` safety guard, the
 * `eq`/`ne` ops, multi-predicate AND, and the `makeRunReferenceFilter`
 * pipeline transform.
 */

import assert from "node:assert/strict"

import type {Chunk} from "@agenta/entities/etl"
import {describe, it} from "vitest"

import {
    collectRoleReferenceKeys,
    evaluateRunReferencePredicate,
    hasResolvableSubject,
    isSubjectRun,
    makeRunReferenceFilter,
    matchesRunReferenceFilter,
    type RunReferenceStep,
} from "../../src/etl/runReferenceFilter"

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
        assert.deepEqual([...collectRoleReferenceKeys(graderRun, "application")], [APP])
        assert.deepEqual(
            [...collectRoleReferenceKeys(graderRun, "evaluator")].sort(),
            [EVALUATOR, "with-reasoning"].sort(),
        )
        assert.deepEqual([...collectRoleReferenceKeys(graderRun, "testset")], ["ts-1"])
    })

    it("includes both id and slug so evaluators match either", () => {
        const keys = collectRoleReferenceKeys(graderRun, "evaluator")
        assert.ok(keys.has(EVALUATOR))
        assert.ok(keys.has("with-reasoning"))
    })

    it("returns empty for missing/empty steps", () => {
        assert.equal(collectRoleReferenceKeys(null, "application").size, 0)
        assert.equal(collectRoleReferenceKeys(undefined, "application").size, 0)
        assert.equal(collectRoleReferenceKeys([], "application").size, 0)
        assert.equal(collectRoleReferenceKeys([{type: "invocation"}], "application").size, 0)
    })

    it("falls back to step.type for a legacy single-reference step", () => {
        const legacy: RunReferenceStep[] = [{type: "invocation", references: {ref: {id: APP}}}]
        assert.deepEqual([...collectRoleReferenceKeys(legacy, "application")], [APP])
    })

    it("does NOT use the legacy fallback when multiple references are present (avoids over-match)", () => {
        const ambiguous: RunReferenceStep[] = [
            {type: "invocation", references: {ref: {id: APP}, other: {id: "x"}}},
        ]
        assert.equal(collectRoleReferenceKeys(ambiguous, "application").size, 0)
    })
})

describe("isSubjectRun / grader distinction", () => {
    it("subject run: the evaluator is the application/subject", () => {
        assert.equal(isSubjectRun(subjectRun, EVALUATOR), true)
    })

    it("grader run: the evaluator is NOT the subject (it's an annotation)", () => {
        assert.equal(isSubjectRun(graderRun, EVALUATOR), false)
    })

    it("the app IS the subject of its own grader run", () => {
        assert.equal(isSubjectRun(graderRun, APP), true)
    })
})

describe("evaluateRunReferencePredicate ops", () => {
    it("eq matches the role's id", () => {
        assert.equal(
            evaluateRunReferencePredicate({role: "evaluator", id: EVALUATOR}, graderRun),
            true,
        )
    })

    it("ne is the complement", () => {
        assert.equal(
            evaluateRunReferencePredicate(
                {role: "application", id: EVALUATOR, op: "ne"},
                graderRun,
            ),
            true,
        )
        assert.equal(
            evaluateRunReferencePredicate(
                {role: "application", id: EVALUATOR, op: "ne"},
                subjectRun,
            ),
            false,
        )
    })

    it("matches an evaluator by slug too", () => {
        assert.equal(
            evaluateRunReferencePredicate({role: "evaluator", id: "with-reasoning"}, graderRun),
            true,
        )
    })
})

describe("hasResolvableSubject", () => {
    it("true when an application reference exists", () => {
        assert.equal(hasResolvableSubject(graderRun), true)
        assert.equal(hasResolvableSubject(subjectRun), true)
    })

    it("false when no application reference can be resolved", () => {
        assert.equal(
            hasResolvableSubject([{type: "annotation", references: {evaluator: {id: EVALUATOR}}}]),
            false,
        )
        assert.equal(hasResolvableSubject([]), false)
        assert.equal(hasResolvableSubject(null), false)
    })
})

describe("matchesRunReferenceFilter (AND-join)", () => {
    it("AND-joins multiple predicates", () => {
        // subject == evaluator AND grader == GRADER
        assert.equal(
            matchesRunReferenceFilter(
                [
                    {role: "application", id: EVALUATOR},
                    {role: "evaluator", id: GRADER},
                ],
                subjectRun,
            ),
            true,
        )
        // subject == evaluator AND grader == (the wrong id) → fails
        assert.equal(
            matchesRunReferenceFilter(
                [
                    {role: "application", id: EVALUATOR},
                    {role: "evaluator", id: "nope"},
                ],
                subjectRun,
            ),
            false,
        )
    })
})

describe("makeRunReferenceFilter (Transform)", () => {
    it("keeps only subject runs and reports chunk telemetry", () => {
        interface Row {
            id: string
            steps: RunReferenceStep[]
        }
        const rows: Row[] = [
            {id: "subject", steps: subjectRun},
            {id: "grader", steps: graderRun},
        ]
        const seen: {scanned: number; matched: number}[] = []
        const filter = makeRunReferenceFilter<Row>({
            predicates: {role: "application", id: EVALUATOR},
            getSteps: (row) => row.steps,
            onChunkFiltered: ({scanned, matched}) => seen.push({scanned, matched}),
        })

        const chunk: Chunk<Row> = {items: rows, cursor: null}
        const out = filter(chunk) as Chunk<Row>

        assert.deepEqual(
            out.items.map((r) => r.id),
            ["subject"],
        )
        assert.deepEqual(seen, [{scanned: 2, matched: 1}])
    })

    it("defaultGetSteps reads row.previewMeta.steps", () => {
        interface Row {
            previewMeta: {steps: RunReferenceStep[]}
        }
        const rows: Row[] = [{previewMeta: {steps: subjectRun}}, {previewMeta: {steps: graderRun}}]
        const filter = makeRunReferenceFilter<Row>({
            predicates: {role: "application", id: EVALUATOR},
        })
        const out = filter({items: rows, cursor: null}) as Chunk<Row>
        assert.equal(out.items.length, 1)
        assert.equal(out.items[0]!.previewMeta.steps, subjectRun)
    })
})
