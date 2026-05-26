/**
 * groupRunColumns — column-parity regression guard for the ETL scenario
 * table migration (docs/designs/eval-scenarios-table-integration.md, T2).
 *
 * The backend-metadata column path (`usePreviewColumns`) and the run-graph
 * column path (`useEtlColumns` → `groupRunColumns`) must surface the SAME
 * visible column set. The most load-bearing part of that: the PoC's
 * `useEtlColumns` dropped `group.kind === "other"` columns ("skip in the
 * test page"). Production must keep them — dropping them silently shrinks
 * the user-visible column set. These tests pin that down.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {groupRunColumns, type RunMapping, type RunStep} from "../resolveMappings"

// A representative testset+app+evaluator run schema. auto / human / online
// runs all share this shape — the eval type only changes which metrics
// show and the scenario fetch order, neither of which `groupRunColumns`
// (a pure steps+mappings function) is aware of.
const STEPS: RunStep[] = [
    {key: "input", type: "input", references: {testset: {id: "ts1", slug: "my-testset"}}},
    {
        key: "invocation",
        type: "invocation",
        references: {application: {id: "app1", slug: "my-app"}},
    },
    {
        key: "eval-exact",
        type: "annotation",
        references: {evaluator: {id: "ev1", slug: "exact-match"}},
    },
]

const MAPPINGS: RunMapping[] = [
    {column: {kind: "input", name: "question"}, step: {key: "input", path: "data.question"}},
    {
        column: {kind: "input", name: "ground_truth"},
        step: {key: "input", path: "data.ground_truth"},
    },
    {
        column: {kind: "invocation", name: "output"},
        step: {key: "invocation", path: "attributes.ag.data.outputs"},
    },
    {
        column: {kind: "annotation", name: "success"},
        step: {key: "eval-exact", path: "attributes.ag.data.outputs.success"},
    },
    // Metrics path overrides the step-type grouping → "metrics" group.
    {
        column: {kind: "metric", name: "Cost"},
        step: {key: "invocation", path: "attributes.ag.metrics.costs.cumulative.total"},
    },
]

describe("groupRunColumns — testset/app/evaluator/metrics", () => {
    it("groups columns by source in stable order", () => {
        const grouped = groupRunColumns(STEPS, MAPPINGS)
        assert.deepEqual(
            grouped.map((g) => g.group.kind),
            ["testset", "application", "evaluator", "metrics"],
        )
    })

    it("keeps every mapped column — none dropped", () => {
        const grouped = groupRunColumns(STEPS, MAPPINGS)
        const total = grouped.reduce((n, g) => n + g.columns.length, 0)
        assert.equal(total, MAPPINGS.length)
    })

    it("places multiple columns under their shared group", () => {
        const grouped = groupRunColumns(STEPS, MAPPINGS)
        const testset = grouped.find((g) => g.group.kind === "testset")
        assert.ok(testset)
        assert.deepEqual(
            testset.columns.map((c) => c.name),
            ["question", "ground_truth"],
        )
    })

    it("carries group kind + slug onto each leaf", () => {
        const grouped = groupRunColumns(STEPS, MAPPINGS)
        const evaluator = grouped.find((g) => g.group.kind === "evaluator")
        assert.ok(evaluator)
        assert.equal(evaluator.columns[0].name, "success")
        assert.equal(evaluator.columns[0].kind, "evaluator")
        assert.equal(evaluator.columns[0].groupSlug, "exact-match")
    })
})

describe("groupRunColumns — 'other' columns are INCLUDED (regression)", () => {
    it("includes columns whose step has an unrecognised type", () => {
        const steps: RunStep[] = [...STEPS, {key: "transform", type: "transform"}]
        const mappings: RunMapping[] = [
            ...MAPPINGS,
            {
                column: {kind: "transform", name: "normalized"},
                step: {key: "transform", path: "data.normalized"},
            },
        ]
        const grouped = groupRunColumns(steps, mappings)
        const other = grouped.find((g) => g.group.kind === "other")
        assert.ok(other, "the unrecognised-step column must produce an 'other' group")
        assert.deepEqual(
            other.columns.map((c) => c.name),
            ["normalized"],
        )
        // "other" sorts last.
        assert.equal(grouped[grouped.length - 1].group.kind, "other")
    })

    it("includes columns whose mapping references a missing step", () => {
        const mappings: RunMapping[] = [
            ...MAPPINGS,
            {column: {kind: "meta", name: "orphan"}, step: {key: "does-not-exist", path: "x"}},
        ]
        const grouped = groupRunColumns(STEPS, mappings)
        const other = grouped.find((g) => g.group.kind === "other")
        assert.ok(other, "a mapping with no resolvable step must produce an 'other' group")
        assert.deepEqual(
            other.columns.map((c) => c.name),
            ["orphan"],
        )
    })

    it("the visible column count includes 'other' columns", () => {
        const steps: RunStep[] = [...STEPS, {key: "transform", type: "transform"}]
        const mappings: RunMapping[] = [
            ...MAPPINGS,
            {column: {name: "normalized"}, step: {key: "transform", path: "p"}},
        ]
        const grouped = groupRunColumns(steps, mappings)
        const total = grouped.reduce((n, g) => n + g.columns.length, 0)
        assert.equal(total, mappings.length)
    })
})

describe("groupRunColumns — edge cases", () => {
    it("skips mappings with no column name", () => {
        const mappings: RunMapping[] = [
            ...MAPPINGS,
            {column: {kind: "input", name: ""}, step: {key: "input", path: "data.blank"}},
            {column: {kind: "input"}, step: {key: "input", path: "data.noname"}},
        ]
        const grouped = groupRunColumns(STEPS, mappings)
        const total = grouped.reduce((n, g) => n + g.columns.length, 0)
        assert.equal(total, MAPPINGS.length)
    })

    it("returns an empty list for an empty schema", () => {
        assert.deepEqual(groupRunColumns([], []), [])
    })

    it("drops internal _dedup_id columns (regression)", () => {
        const mappings: RunMapping[] = [
            ...MAPPINGS,
            {
                column: {kind: "input", name: "testcase_dedup_id"},
                step: {key: "input", path: "data.testcase_dedup_id"},
            },
        ]
        const grouped = groupRunColumns(STEPS, mappings)
        const names = grouped.flatMap((g) => g.columns.map((c) => c.name))
        assert.equal(names.includes("testcase_dedup_id"), false)
        // The dedup column is excluded; every other mapped column is kept.
        assert.equal(
            grouped.reduce((n, g) => n + g.columns.length, 0),
            MAPPINGS.length,
        )
    })

    it("disambiguates two evaluators emitting the same column name", () => {
        const steps: RunStep[] = [
            ...STEPS,
            {
                key: "eval-judge",
                type: "annotation",
                references: {evaluator: {id: "ev2", slug: "llm-judge"}},
            },
        ]
        const mappings: RunMapping[] = [
            ...MAPPINGS,
            {
                column: {kind: "annotation", name: "success"},
                step: {key: "eval-judge", path: "attributes.ag.data.outputs.success"},
            },
        ]
        const grouped = groupRunColumns(steps, mappings)
        const evaluators = grouped.filter((g) => g.group.kind === "evaluator")
        assert.equal(evaluators.length, 2)
        assert.deepEqual(
            evaluators.map((g) => g.group.slug),
            ["exact-match", "llm-judge"],
        )
    })
})
