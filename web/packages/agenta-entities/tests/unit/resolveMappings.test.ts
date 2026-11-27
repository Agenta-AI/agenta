/**
 * resolveMappings — unit tests covering known shapes + extensibility.
 *
 * The point of these tests: any future change to resolver shapes or step
 * types should be confirmed against this suite before shipping. New shapes
 * encountered in the wild should be added here so we don't re-encounter
 * the same patch-each-time problem.
 */

import {describe, expect, it} from "vitest"

import type {
    HydratedScenarioRow,
    HydratableScenario,
} from "../../src/evaluationRun/etl/hydrateScenariosTransform"
import {
    DEFAULT_STEP_RESOLVERS,
    composeResolvers,
    computeColumnGroup,
    findInTrace,
    getAtPath,
    resolveMappings,
    type RunSchema,
    type StepResolver,
} from "../../src/evaluationRun/etl/resolveMappings"

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
        expect(getAtPath({a: {b: {c: 7}}}, "a.b.c")).toBe(7)
    })

    it("returns undefined for missing intermediate", () => {
        expect(getAtPath({a: {}}, "a.b.c")).toBe(undefined)
    })

    it("returns undefined for non-object intermediate", () => {
        expect(getAtPath({a: 1}, "a.b")).toBe(undefined)
    })

    it("returns undefined for empty path", () => {
        expect(getAtPath({a: 1}, "")).toBe(undefined)
    })

    it("returns undefined for null/undefined input", () => {
        expect(getAtPath(null, "a")).toBe(undefined)
        expect(getAtPath(undefined, "a")).toBe(undefined)
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
        expect(findInTrace(trace, path)).toBe(leaf)
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
        expect(findInTrace(trace, path)).toBe(leaf)
    })

    it("Shape B: span array under .spans", () => {
        const trace = {
            spans: [{attributes: {ag: {data: {outputs: leaf}}}}],
        }
        expect(findInTrace(trace, path)).toBe(leaf)
    })

    it("Shape C: {response: {tree: [span]}} (agenta-format wrapped)", () => {
        const trace = {
            response: {
                tree: [{attributes: {ag: {data: {outputs: leaf}}}}],
            },
        }
        expect(findInTrace(trace, path)).toBe(leaf)
    })

    it("Shape D: envelope IS a span", () => {
        const trace = {attributes: {ag: {data: {outputs: leaf}}}}
        expect(findInTrace(trace, path)).toBe(leaf)
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
        expect(findInTrace(trace, path)).toBe(leaf)
    })

    it("returns undefined when nothing matches", () => {
        expect(findInTrace({spans: {root: {other: "thing"}}}, path)).toBe(undefined)
    })

    it("returns undefined for non-object input", () => {
        expect(findInTrace(null, path)).toBe(undefined)
        expect(findInTrace("string", path)).toBe(undefined)
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
        expect(col.value).toBe("USA")
        expect(col.source).toBe("testcase")
    })

    it("returns missing when testcase is null", () => {
        const row = makeRow({testcase: null})
        const [col] = resolveMappings(row, schema)
        expect(col.value).toBe(undefined)
        expect(col.source).toBe("missing")
    })

    it("returns missing when path not present", () => {
        const row = makeRow({
            testcase: {
                id: "tc1",
                data: {},
            } as unknown as HydratedScenarioRow<TestScenario>["testcase"],
        })
        const [col] = resolveMappings(row, schema)
        expect(col.value).toBe(undefined)
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
        expect(col.value).toBe("the answer")
        expect(col.source).toBe("trace")
        expect(col.stepType).toBe("invocation")
    })

    it("returns missing when no result for the step", () => {
        const row = makeRow({results: []})
        const [col] = resolveMappings(row, schema)
        expect(col.source).toBe("missing")
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
        expect(col.source).toBe("missing")
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
        expect(col.source).toBe("metric")
        // The stats blob is returned as-is (not unwrapped) — that's the wire shape
        const v = col.value as {type: string; freq: unknown[]}
        expect(v.type).toBe("binary")
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
        expect(col.source).toBe("trace")
        expect(col.value).toBe(true)
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
        expect(col.source).toBe("trace")
        expect(col.value).toBe("the model was correct")
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
        expect(col.source).toBe("metric")
        const v = col.value as {type: string; freq: unknown[]}
        expect(v.type).toBe("string")
        expect(v.freq).toEqual([{value: "yes", count: 2}])
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
        expect(col.source).toBe("missing")
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
        expect(col1.value).toBe(undefined)
        expect(col1.source).toMatch(/no resolver for step\.type="my_custom"/)

        // With a custom resolver
        const myResolver: StepResolver = () => ({value: 42, source: "custom-magic"})
        const [col2] = resolveMappings(row, schema, {customResolvers: {my_custom: myResolver}})
        expect(col2.value).toBe(42)
        expect(col2.source).toBe("custom-magic")
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
        expect(col.value).toBe("OVERRIDE")
        expect(col.source).toBe("override")
    })

    it("fallbackResolver is invoked for unknown step types when set", () => {
        const schema: RunSchema = {
            steps: [{key: "anything-1", type: "weird"}],
            mappings: [{column: {kind: "?", name: "x"}, step: {key: "anything-1", path: "p"}}],
        }
        const row = makeRow()
        const fallback: StepResolver = () => ({value: "fallback-val", source: "fallback"})
        const [col] = resolveMappings(row, schema, {fallbackResolver: fallback})
        expect(col.value).toBe("fallback-val")
        expect(col.source).toBe("fallback")
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
        expect(out).toEqual({value: "b", source: "B"})
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
        expect(out).toBe(null)
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
        expect(g.kind).toBe("testset")
        expect(g.slug).toBe("my-testset")
        expect(g.label).toBe("Testset my-testset")
        expect(g.key).toBe("testset:my-testset")
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
        expect(g.kind).toBe("application")
        expect(g.slug).toBe("comp-1")
        expect(g.label).toBe("Application comp-1")
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
        expect(g.kind).toBe("evaluator")
        expect(g.slug).toBe("exact-match")
        expect(g.label, "slug 'exact-match' → 'Exact Match'").toBe("Exact Match")
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
        expect(g1.key).not.toBe(g2.key)
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
        expect(g.kind).toBe("metrics")
        expect(g.label).toBe("Metrics")
        expect(g.key).toBe("metrics")
    })

    it("missing step → 'other' group", () => {
        const g = computeColumnGroup(null, "anything")
        expect(g.kind).toBe("other")
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
        expect(g.kind).toBe("testset")
        expect(g.slug).toBe("rev-abc")
    })
})

describe("edge cases", () => {
    it("schema with no mappings → empty result", () => {
        const cols = resolveMappings(makeRow(), {steps: [], mappings: []})
        expect(cols).toEqual([])
    })

    it("mapping referring to unknown step key → missing", () => {
        const schema: RunSchema = {
            steps: [],
            mappings: [{column: {kind: "x", name: "y"}, step: {key: "nope", path: "p"}}],
        }
        const [col] = resolveMappings(makeRow(), schema)
        expect(col.source).toBe("missing")
        expect(col.stepType).toBe("?")
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
        expect(cols[0].name).toBe("second")
        expect(cols[0].value).toBe(2)
        expect(cols[1].name).toBe("first")
        expect(cols[1].value).toBe(1)
    })

    it("DEFAULT_STEP_RESOLVERS contains the three built-in types", () => {
        expect(typeof DEFAULT_STEP_RESOLVERS.input === "function").toBeTruthy()
        expect(typeof DEFAULT_STEP_RESOLVERS.invocation === "function").toBeTruthy()
        expect(typeof DEFAULT_STEP_RESOLVERS.annotation === "function").toBeTruthy()
    })
})
