/**
 * resolveMappings — unit tests covering known shapes + extensibility.
 *
 * The point of these tests: any future change to resolver shapes or step
 * types should be confirmed against this suite before shipping. New shapes
 * encountered in the wild should be added here so we don't re-encounter
 * the same patch-each-time problem.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import type {HydratedScenarioRow, HydratableScenario} from "../hydrateScenariosTransform"
import {
    DEFAULT_STEP_RESOLVERS,
    composeResolvers,
    computeColumnGroup,
    findInTrace,
    getAtPath,
    groupResolvedColumns,
    resolveMappings,
    type RunSchema,
    type StepResolver,
} from "../resolveMappings"

interface TestScenario extends HydratableScenario {
    id: string
    status: string
    testcase_id?: string | null
}

function makeRow(overrides: Partial<HydratedScenarioRow<TestScenario>> = {}) {
    const base: HydratedScenarioRow<TestScenario> = {
        scenario: {id: "scen1", status: "success", testcase_id: null},
        results: [],
        metrics: [],
        testcase: null,
        traces: {},
    }
    return {...base, ...overrides}
}

// =============================================================================
// getAtPath — dot-path traversal
// =============================================================================

describe("getAtPath", () => {
    it("returns nested values", () => {
        assert.equal(getAtPath({a: {b: {c: 7}}}, "a.b.c"), 7)
    })

    it("returns undefined for missing intermediate", () => {
        assert.equal(getAtPath({a: {}}, "a.b.c"), undefined)
    })

    it("returns undefined for non-object intermediate", () => {
        assert.equal(getAtPath({a: 1}, "a.b"), undefined)
    })

    it("returns undefined for empty path", () => {
        assert.equal(getAtPath({a: 1}, ""), undefined)
    })

    it("returns undefined for null/undefined input", () => {
        assert.equal(getAtPath(null, "a"), undefined)
        assert.equal(getAtPath(undefined, "a"), undefined)
    })
})

// =============================================================================
// findInTrace — multi-shape trace navigation
// =============================================================================

describe("findInTrace", () => {
    const path = "attributes.ag.data.outputs"
    const leaf = "some output"

    it("Shape A: {spans: {<name>: span}} (bulk fetch)", () => {
        const trace = {
            spans: {
                completion_v0: {
                    attributes: {ag: {data: {outputs: leaf}}},
                },
            },
        }
        assert.equal(findInTrace(trace, path), leaf)
    })

    it("Shape A nested: data lives on a child span, not the root", () => {
        const trace = {
            spans: {
                completion_v0: {
                    span_name: "root",
                    spans: {
                        litellm_client: {
                            attributes: {ag: {data: {outputs: leaf}}},
                        },
                    },
                },
            },
        }
        assert.equal(findInTrace(trace, path), leaf)
    })

    it("Shape B: span array under .spans", () => {
        const trace = {
            spans: [{attributes: {ag: {data: {outputs: leaf}}}}],
        }
        assert.equal(findInTrace(trace, path), leaf)
    })

    it("Shape C: {response: {tree: [span]}} (agenta-format wrapped)", () => {
        const trace = {
            response: {
                tree: [{attributes: {ag: {data: {outputs: leaf}}}}],
            },
        }
        assert.equal(findInTrace(trace, path), leaf)
    })

    it("Shape D: envelope IS a span", () => {
        const trace = {attributes: {ag: {data: {outputs: leaf}}}}
        assert.equal(findInTrace(trace, path), leaf)
    })

    it("descends through .children arrays", () => {
        const trace = {
            span_name: "root",
            children: [
                {
                    span_name: "child1",
                    children: [{attributes: {ag: {data: {outputs: leaf}}}}],
                },
            ],
        }
        assert.equal(findInTrace(trace, path), leaf)
    })

    it("returns undefined when nothing matches", () => {
        assert.equal(findInTrace({spans: {root: {other: "thing"}}}, path), undefined)
    })

    it("returns undefined for non-object input", () => {
        assert.equal(findInTrace(null, path), undefined)
        assert.equal(findInTrace("string", path), undefined)
    })
})

// =============================================================================
// Built-in resolvers (via DEFAULT_STEP_RESOLVERS)
// =============================================================================

describe("input step → resolveFromTestcase", () => {
    const schema: RunSchema = {
        steps: [{key: "testset-1", type: "input"}],
        mappings: [
            {
                column: {kind: "testset", name: "country"},
                step: {key: "testset-1", path: "data.country"},
            },
        ],
    }

    it("resolves when testcase is present", () => {
        const row = makeRow({
            testcase: {
                id: "tc1",
                data: {country: "USA"},
            } as unknown as HydratedScenarioRow<TestScenario>["testcase"],
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.value, "USA")
        assert.equal(col.source, "testcase")
    })

    it("returns missing when testcase is null", () => {
        const row = makeRow({testcase: null})
        const [col] = resolveMappings(row, schema)
        assert.equal(col.value, undefined)
        assert.equal(col.source, "missing")
    })

    it("returns missing when path not present", () => {
        const row = makeRow({
            testcase: {
                id: "tc1",
                data: {},
            } as unknown as HydratedScenarioRow<TestScenario>["testcase"],
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.value, undefined)
    })
})

describe("invocation step → resolveFromTrace", () => {
    const schema: RunSchema = {
        steps: [{key: "app-1", type: "invocation"}],
        mappings: [
            {
                column: {kind: "invocation", name: "outputs"},
                step: {key: "app-1", path: "attributes.ag.data.outputs"},
            },
        ],
    }

    it("resolves via the trace pointed to by result.trace_id", () => {
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "app-1",
                    trace_id: "trace-abc",
                    status: "success",
                },
            ],
            traces: {
                "trace-abc": {
                    spans: {
                        completion_v0: {
                            attributes: {ag: {data: {outputs: "the answer"}}},
                        },
                    },
                },
            },
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.value, "the answer")
        assert.equal(col.source, "trace")
        assert.equal(col.stepType, "invocation")
    })

    it("returns missing when no result for the step", () => {
        const row = makeRow({results: []})
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "missing")
    })

    it("returns missing when trace not in row.traces", () => {
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "app-1",
                    trace_id: "trace-abc",
                    status: "success",
                },
            ],
            // traces map empty → no entry for "trace-abc"
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "missing")
    })
})

describe("annotation step → composeResolvers(metric, trace)", () => {
    const schema: RunSchema = {
        steps: [{key: "eval-1", type: "annotation"}],
        mappings: [
            {
                column: {kind: "annotation", name: "success"},
                step: {key: "eval-1", path: "attributes.ag.data.outputs.success"},
            },
        ],
    }

    it("prefers metric.data when present (flat key, not dot-walk)", () => {
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "eval-1",
                    trace_id: "trace-eval",
                    status: "success",
                },
            ],
            metrics: [
                {
                    id: "m1",
                    run_id: "r1",
                    data: {
                        "eval-1": {
                            "attributes.ag.data.outputs.success": {
                                type: "binary",
                                freq: [{value: false, density: 1}],
                            },
                        },
                    },
                } as unknown as HydratedScenarioRow<TestScenario>["metrics"][number],
            ],
            traces: {
                "trace-eval": {
                    spans: {
                        eval_v0: {
                            attributes: {ag: {data: {outputs: {success: false}}}},
                        },
                    },
                },
            },
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "metric")
        // The stats blob is returned as-is (not unwrapped) — that's the wire shape
        const v = col.value as {type: string; freq: unknown[]}
        assert.equal(v.type, "binary")
    })

    it("falls back to trace when metric is missing or has no bucket for the step", () => {
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "eval-1",
                    trace_id: "trace-eval",
                    status: "success",
                },
            ],
            metrics: [], // no metric — fall through to trace
            traces: {
                "trace-eval": {
                    spans: {
                        eval_v0: {attributes: {ag: {data: {outputs: {success: true}}}}},
                    },
                },
            },
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "trace")
        assert.equal(col.value, true)
    })

    it("falls through to trace when metric value is a string-type placeholder", () => {
        // String-typed evaluator outputs (e.g. an LLM-judge `reasoning`
        // field) only land in the metric layer as a `{type: "string",
        // count: N}` placeholder — the real value is on the annotation
        // trace. `resolveFromMetric` must return null for that shape so the
        // composed `resolveFromTrace` fallback picks the actual string up.
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "eval-1",
                    trace_id: "trace-eval",
                    status: "success",
                },
            ],
            metrics: [
                {
                    id: "m1",
                    run_id: "r1",
                    data: {
                        "eval-1": {
                            "attributes.ag.data.outputs.success": {
                                type: "string",
                                count: 3,
                            },
                        },
                    },
                } as unknown as HydratedScenarioRow<TestScenario>["metrics"][number],
            ],
            traces: {
                "trace-eval": {
                    spans: {
                        eval_v0: {
                            attributes: {
                                ag: {data: {outputs: {success: "the model was correct"}}},
                            },
                        },
                    },
                },
            },
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "trace")
        assert.equal(col.value, "the model was correct")
    })

    it("keeps the metric value when the string-typed entry has distribution data", () => {
        // A `{type: "string"}` shape that ALSO carries `freq` / `value` /
        // etc. is real distribution data (not a placeholder) and must be
        // returned as-is — only the bare `{type, count}` shape falls
        // through.
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "eval-1",
                    trace_id: "trace-eval",
                    status: "success",
                },
            ],
            metrics: [
                {
                    id: "m1",
                    run_id: "r1",
                    data: {
                        "eval-1": {
                            "attributes.ag.data.outputs.success": {
                                type: "string",
                                count: 3,
                                freq: [{value: "yes", count: 2}],
                            },
                        },
                    },
                } as unknown as HydratedScenarioRow<TestScenario>["metrics"][number],
            ],
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "metric")
        const v = col.value as {type: string; freq: unknown[]}
        assert.equal(v.type, "string")
        assert.deepEqual(v.freq, [{value: "yes", count: 2}])
    })

    it("returns missing when neither metric nor trace has the path", () => {
        const row = makeRow({
            results: [
                {
                    run_id: "r1",
                    scenario_id: "scen1",
                    step_key: "eval-1",
                    trace_id: "trace-eval",
                    status: "success",
                },
            ],
            traces: {"trace-eval": {spans: {eval_v0: {other: "thing"}}}},
        })
        const [col] = resolveMappings(row, schema)
        assert.equal(col.source, "missing")
    })
})

// =============================================================================
// Extensibility — custom step types
// =============================================================================

describe("customResolvers extensibility", () => {
    it("a new step.type can be added without editing the registry", () => {
        const schema: RunSchema = {
            steps: [{key: "custom-1", type: "my_custom"}],
            mappings: [{column: {kind: "custom", name: "x"}, step: {key: "custom-1", path: "x"}}],
        }
        const row = makeRow()

        // Without a custom resolver: missing with descriptive source
        const [col1] = resolveMappings(row, schema)
        assert.equal(col1.value, undefined)
        assert.match(col1.source, /no resolver for step\.type="my_custom"/)

        // With a custom resolver
        const myResolver: StepResolver = () => ({value: 42, source: "custom-magic"})
        const [col2] = resolveMappings(row, schema, {customResolvers: {my_custom: myResolver}})
        assert.equal(col2.value, 42)
        assert.equal(col2.source, "custom-magic")
    })

    it("customResolvers can override a built-in", () => {
        const schema: RunSchema = {
            steps: [{key: "testset-1", type: "input"}],
            mappings: [
                {
                    column: {kind: "testset", name: "country"},
                    step: {key: "testset-1", path: "data.country"},
                },
            ],
        }
        const row = makeRow({
            testcase: {
                id: "tc1",
                data: {country: "USA"},
            } as unknown as HydratedScenarioRow<TestScenario>["testcase"],
        })

        const override: StepResolver = () => ({value: "OVERRIDE", source: "override"})
        const [col] = resolveMappings(row, schema, {customResolvers: {input: override}})
        assert.equal(col.value, "OVERRIDE")
        assert.equal(col.source, "override")
    })

    it("fallbackResolver is invoked for unknown step types when set", () => {
        const schema: RunSchema = {
            steps: [{key: "anything-1", type: "weird"}],
            mappings: [{column: {kind: "?", name: "x"}, step: {key: "anything-1", path: "p"}}],
        }
        const row = makeRow()
        const fallback: StepResolver = () => ({value: "fallback-val", source: "fallback"})
        const [col] = resolveMappings(row, schema, {fallbackResolver: fallback})
        assert.equal(col.value, "fallback-val")
        assert.equal(col.source, "fallback")
    })
})

describe("composeResolvers", () => {
    it("returns the first non-null", () => {
        const a: StepResolver = () => null
        const b: StepResolver = () => ({value: "b", source: "B"})
        const c: StepResolver = () => ({value: "c", source: "C"})
        const composed = composeResolvers(a, b, c)
        const out = composed({
            step: {key: "k", type: "t"},
            result: undefined,
            row: makeRow(),
            path: "",
        })
        assert.deepEqual(out, {value: "b", source: "B"})
    })

    it("returns null when all return null", () => {
        const composed = composeResolvers(
            () => null,
            () => null,
        )
        const out = composed({
            step: {key: "k", type: "t"},
            result: undefined,
            row: makeRow(),
            path: "",
        })
        assert.equal(out, null)
    })
})

// =============================================================================
// Edge cases
// =============================================================================

// =============================================================================
// Column grouping — namespacing for multiple evaluators + metrics override
// =============================================================================

describe("computeColumnGroup", () => {
    it("input step → testset group keyed by testset.slug", () => {
        const g = computeColumnGroup(
            {
                key: "testset-x",
                type: "input",
                references: {testset: {id: "t1", slug: "my-testset"}},
            },
            "data.country",
        )
        assert.equal(g.kind, "testset")
        assert.equal(g.slug, "my-testset")
        assert.equal(g.label, "Testset my-testset")
        assert.equal(g.key, "testset:my-testset")
    })

    it("invocation step → application group keyed by application.slug", () => {
        const g = computeColumnGroup(
            {
                key: "app-x",
                type: "invocation",
                references: {application: {id: "a1", slug: "comp-1"}},
            },
            "attributes.ag.data.outputs",
        )
        assert.equal(g.kind, "application")
        assert.equal(g.slug, "comp-1")
        assert.equal(g.label, "Application comp-1")
    })

    it("annotation step → evaluator group titlecased from slug", () => {
        const g = computeColumnGroup(
            {
                key: "eval-x",
                type: "annotation",
                references: {evaluator: {id: "e1", slug: "exact-match"}},
            },
            "attributes.ag.data.outputs.success",
        )
        assert.equal(g.kind, "evaluator")
        assert.equal(g.slug, "exact-match")
        assert.equal(g.label, "Exact Match", "slug 'exact-match' → 'Exact Match'")
    })

    it("two annotation steps with same column name get distinct groups", () => {
        const g1 = computeColumnGroup(
            {
                key: "eval-1",
                type: "annotation",
                references: {evaluator: {id: "e-exact", slug: "exact-match"}},
            },
            "attributes.ag.data.outputs.success",
        )
        const g2 = computeColumnGroup(
            {
                key: "eval-2",
                type: "annotation",
                references: {evaluator: {id: "e-fuzzy", slug: "fuzzy-match"}},
            },
            "attributes.ag.data.outputs.success",
        )
        // Same column NAME, different group KEY — no collision.
        assert.notEqual(g1.key, g2.key)
    })

    it("metrics path overrides step type — goes to Metrics group", () => {
        // An invocation-step mapping pointing at attributes.ag.metrics.* still
        // belongs to the cross-cutting Metrics group (per UI layout).
        const g = computeColumnGroup(
            {
                key: "app-x",
                type: "invocation",
                references: {application: {id: "a-comp-1", slug: "comp-1"}},
            },
            "attributes.ag.metrics.tokens.cumulative.total",
        )
        assert.equal(g.kind, "metrics")
        assert.equal(g.label, "Metrics")
        assert.equal(g.key, "metrics")
    })

    it("missing step → 'other' group", () => {
        const g = computeColumnGroup(null, "anything")
        assert.equal(g.kind, "other")
    })

    it("references fallback: testset_revision.slug if testset.slug absent", () => {
        const g = computeColumnGroup(
            {
                key: "k",
                type: "input",
                references: {testset_revision: {id: "tr-rev-abc", slug: "rev-abc"}},
            },
            "data.x",
        )
        assert.equal(g.kind, "testset")
        assert.equal(g.slug, "rev-abc")
    })
})

describe("groupResolvedColumns", () => {
    it("groups columns by group.key preserving mapping order within a group", () => {
        const schema: RunSchema = {
            steps: [
                {
                    key: "testset-1",
                    type: "input",
                    references: {testset: {id: "t1", slug: "my-testset"}},
                },
                {
                    key: "eval-1",
                    type: "annotation",
                    references: {evaluator: {id: "e-exact", slug: "exact-match"}},
                },
                {
                    key: "eval-2",
                    type: "annotation",
                    references: {evaluator: {id: "e-fuzzy", slug: "fuzzy-match"}},
                },
            ],
            mappings: [
                {
                    column: {kind: "testset", name: "country"},
                    step: {key: "testset-1", path: "data.country"},
                },
                {
                    column: {kind: "annotation", name: "success"},
                    step: {key: "eval-1", path: "attributes.ag.data.outputs.success"},
                },
                {
                    column: {kind: "annotation", name: "success"},
                    step: {key: "eval-2", path: "attributes.ag.data.outputs.success"},
                },
                {
                    column: {kind: "testset", name: "expected"},
                    step: {key: "testset-1", path: "data.expected"},
                },
            ],
        }
        const row = {
            scenario: {id: "s1", status: "success"},
            results: [],
            metrics: [],
            testcase: null,
            traces: {},
        } as unknown as Parameters<typeof resolveMappings>[0]
        const cols = resolveMappings(row, schema)
        const groups = groupResolvedColumns(cols)

        assert.equal(groups.length, 3, "3 groups: 1 testset, 2 evaluators")
        // Order: testset first, then evaluators in first-appearance order
        assert.equal(groups[0].group.kind, "testset")
        assert.equal(groups[0].group.label, "Testset my-testset")
        assert.equal(groups[0].columns.length, 2)
        assert.equal(groups[0].columns[0].name, "country")
        assert.equal(groups[0].columns[1].name, "expected")
        assert.equal(groups[1].group.label, "Exact Match")
        assert.equal(groups[2].group.label, "Fuzzy Match")
        // Both evaluators have a "success" column but they're in separate groups
        assert.equal(groups[1].columns[0].name, "success")
        assert.equal(groups[2].columns[0].name, "success")
    })

    it("metrics paths from multiple steps all land in one 'Metrics' group", () => {
        const schema: RunSchema = {
            steps: [
                {
                    key: "app-1",
                    type: "invocation",
                    references: {application: {id: "a-comp-1", slug: "comp-1"}},
                },
            ],
            mappings: [
                {
                    column: {kind: "invocation", name: "outputs"},
                    step: {key: "app-1", path: "attributes.ag.data.outputs"},
                },
                {
                    column: {kind: "invocation", name: "tokens"},
                    step: {key: "app-1", path: "attributes.ag.metrics.tokens.cumulative.total"},
                },
                {
                    column: {kind: "invocation", name: "cost"},
                    step: {key: "app-1", path: "attributes.ag.metrics.costs.cumulative.total"},
                },
            ],
        }
        const row = {
            scenario: {id: "s1", status: "success"},
            results: [],
            metrics: [],
            testcase: null,
            traces: {},
        } as unknown as Parameters<typeof resolveMappings>[0]
        const cols = resolveMappings(row, schema)
        const groups = groupResolvedColumns(cols)

        // application group + metrics group
        assert.equal(groups.length, 2)
        assert.equal(groups[0].group.kind, "application")
        assert.equal(groups[1].group.kind, "metrics")
        assert.equal(groups[1].columns.length, 2)
        assert.deepEqual(groups[1].columns.map((c) => c.name).sort(), ["cost", "tokens"])
    })

    it("group ordering: testset → application → evaluator → metrics → other", () => {
        const schema: RunSchema = {
            steps: [
                {key: "ts", type: "input", references: {testset: {id: "ts1", slug: "ts1"}}},
                {key: "app", type: "invocation", references: {application: {id: "a1", slug: "a1"}}},
                {key: "ev", type: "annotation", references: {evaluator: {id: "e1", slug: "e1"}}},
            ],
            // Intentionally out-of-order in mappings to verify the sort
            mappings: [
                {
                    column: {kind: "annotation", name: "success"},
                    step: {key: "ev", path: "attributes.ag.data.outputs.success"},
                },
                {
                    column: {kind: "invocation", name: "tokens"},
                    step: {key: "app", path: "attributes.ag.metrics.tokens.cumulative.total"},
                },
                {
                    column: {kind: "testset", name: "country"},
                    step: {key: "ts", path: "data.country"},
                },
                {
                    column: {kind: "invocation", name: "outputs"},
                    step: {key: "app", path: "attributes.ag.data.outputs"},
                },
            ],
        }
        const row = {
            scenario: {id: "s1", status: "success"},
            results: [],
            metrics: [],
            testcase: null,
            traces: {},
        } as unknown as Parameters<typeof resolveMappings>[0]
        const cols = resolveMappings(row, schema)
        const groups = groupResolvedColumns(cols)
        assert.deepEqual(
            groups.map((g) => g.group.kind),
            ["testset", "application", "evaluator", "metrics"],
        )
    })
})

describe("edge cases", () => {
    it("schema with no mappings → empty result", () => {
        const cols = resolveMappings(makeRow(), {steps: [], mappings: []})
        assert.deepEqual(cols, [])
    })

    it("mapping referring to unknown step key → missing", () => {
        const schema: RunSchema = {
            steps: [],
            mappings: [{column: {kind: "x", name: "y"}, step: {key: "nope", path: "p"}}],
        }
        const [col] = resolveMappings(makeRow(), schema)
        assert.equal(col.source, "missing")
        assert.equal(col.stepType, "?")
    })

    it("preserves mapping order", () => {
        const schema: RunSchema = {
            steps: [
                {key: "a", type: "input"},
                {key: "b", type: "input"},
            ],
            mappings: [
                {column: {kind: "testset", name: "second"}, step: {key: "b", path: "data.b"}},
                {column: {kind: "testset", name: "first"}, step: {key: "a", path: "data.a"}},
            ],
        }
        const row = makeRow({
            testcase: {
                id: "tc",
                data: {a: 1, b: 2},
            } as unknown as HydratedScenarioRow<TestScenario>["testcase"],
        })
        const cols = resolveMappings(row, schema)
        assert.equal(cols[0].name, "second")
        assert.equal(cols[0].value, 2)
        assert.equal(cols[1].name, "first")
        assert.equal(cols[1].value, 1)
    })

    it("DEFAULT_STEP_RESOLVERS contains the three built-in types", () => {
        assert.ok(typeof DEFAULT_STEP_RESOLVERS.input === "function")
        assert.ok(typeof DEFAULT_STEP_RESOLVERS.invocation === "function")
        assert.ok(typeof DEFAULT_STEP_RESOLVERS.annotation === "function")
    })
})
