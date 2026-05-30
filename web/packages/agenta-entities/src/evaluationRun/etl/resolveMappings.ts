/**
 * resolveMappings — turns a hydrated row + the run's schema (steps + mappings)
 * into the named-column values the UI would render.
 *
 * # Why this exists
 *
 * Evaluation runs are self-describing. `run.data.steps` declares the eval
 * graph and `run.data.mappings` declares the UI columns. Each mapping says
 * "column X is at `step.path` on the step named `step.key`". The mapping is
 * declarative — the renderer doesn't need to know *which* run type it is.
 *
 * Different runs (testset+app+evaluator, chat eval, multi-step, custom origin)
 * use the same vocabulary but with different step compositions. To support
 * any combination without growing a giant `if (kind === ...)` ladder, this
 * module dispatches on **step.type** (`input`, `invocation`, `annotation`,
 * or whatever custom type a workflow declares) and each step type has its
 * own resolver strategy.
 *
 * # Resolution rules
 *
 * - **input** — the step's result carries `testcase_id`; the path is applied
 *   to the joined testcase (e.g. `data.country` → `testcase.data.country`).
 * - **invocation** — the step's result carries `trace_id`; the path is applied
 *   to the trace's span tree (e.g. `attributes.ag.data.outputs`).
 * - **annotation** — same as invocation, with `metric.data[step.key][path]` as
 *   a faster pre-aggregated alternative (path is a flat key inside the metric
 *   bucket, not a dot-walk — this matches the wire format).
 *
 * # Generalization, not special-casing
 *
 * The dispatch is on `step.type`, which the *run document* sets. Adding a new
 * step type is done by registering a new strategy — never by editing this
 * file's existing branches. The trace walker tolerates multiple envelope
 * shapes (`{spans: {name: span}}`, `{response: {tree: [...]}}`, span arrays,
 * deep child trees) so trace navigation doesn't break across run types or
 * fetch endpoints.
 *
 * @packageDocumentation
 */

import type {EvaluationResult} from "../core"

import type {HydratedScenarioRow, HydratableScenario} from "./hydrateScenariosTransform"

// ============================================================================
// Schema types (mirroring run.data.steps / run.data.mappings)
// ============================================================================

export interface RunStep {
    key: string
    /**
     * Drives resolver selection. Built-in resolvers exist for "input",
     * "invocation", "annotation". Custom workflows can register more.
     */
    type: string
    origin?: string | null
    references?: Record<string, {id: string; slug?: string; version?: string} | null> | null
    inputs?: {key: string}[] | null
}

export interface RunMapping {
    column?: {kind?: string | null; name?: string | null} | null
    step?: {key: string; path?: string | null} | null
}

export interface RunSchema {
    steps: RunStep[]
    mappings: RunMapping[]
}

// ============================================================================
// Output types
// ============================================================================

/**
 * Where a resolved value came from. Useful for diagnostics + telemetry.
 * Open-ended on purpose — custom resolvers can return any string.
 */
export type ResolveSource = string

/**
 * The column's source-namespace.
 *
 * Two scenarios can run multiple evaluators. Each evaluator emits its own
 * `success`/`error`/etc columns. To avoid name collisions in the UI the
 * columns are namespaced by their source entity (the testset, the
 * application, the specific evaluator). Group info is computed from
 * `step.type` + `step.references` + path heuristics.
 *
 * The screenshot's column headers map to ColumnGroup like:
 *   "Testset testset-large"  → kind="testset", slug=<testset slug>
 *   "Application comp-1"     → kind="application", slug=<app slug>
 *   "Exact Match"            → kind="evaluator", slug="exact-match"
 *   "Metrics"                → kind="metrics" (overrides step-type when path is under attributes.ag.metrics.*)
 */
export interface ColumnGroup {
    /** Source category — drives header rendering and ordering. */
    kind: "testset" | "application" | "evaluator" | "metrics" | "other"
    /**
     * Stable identity for the group within its kind. For testsets it's the
     * testset slug; for evaluators it's the evaluator slug; for metrics
     * (the cross-cutting "Metrics" group) it's null because metrics columns
     * from multiple sources can coexist in the same group.
     */
    slug: string | null
    /** Human-readable group label (e.g. "Application comp-1", "Exact Match"). */
    label: string
    /** Stable cache key for this group — useful for grouping in renderers. */
    key: string
    /** The step.references that drove the grouping (preserved for downstream code). */
    refs: Record<string, {id?: string; slug?: string} | null | undefined> | null
}

export interface ResolvedColumn {
    /** UI column name (display). */
    name: string
    /** UI column kind (display category, e.g. "testset"). */
    kind: string
    /** The step this column reads from. */
    stepKey: string
    /** The step's declared type — drives strategy choice. */
    stepType: string
    /** The path the strategy applied. */
    path: string
    /** The resolved value (undefined if no strategy returned). */
    value: unknown
    /** Which strategy returned the value, or "missing". */
    source: ResolveSource
    /** Source-namespace for this column (testset/app/evaluator/metrics). */
    group: ColumnGroup
}

// ============================================================================
// Strategy contract
// ============================================================================

export interface ResolveContext<TScenario extends HydratableScenario> {
    /** The step the current mapping references. */
    step: RunStep
    /**
     * The result for this step within the current scenario, or undefined if
     * the scenario has no result for this step (in-progress / failed run).
     */
    result: EvaluationResult | undefined
    /** The hydrated row with all joined entities. */
    row: HydratedScenarioRow<TScenario>
    /** The mapping's `step.path` value. */
    path: string
}

/**
 * A resolver returns either `null` (this strategy can't resolve — try next)
 * or a `{value, source}` tuple. Returning `{value: undefined, source: ...}`
 * is allowed and lets a strategy explicitly say "I looked but the value
 * isn't there"; the caller distinguishes that from "didn't try" (null).
 */
export type StepResolver<TScenario extends HydratableScenario = HydratableScenario> = (
    ctx: ResolveContext<TScenario>,
) => {value: unknown; source: ResolveSource} | null

// ============================================================================
// Built-in strategies
// ============================================================================

/**
 * Read a value at a dot-path on an object, descending one key at a time.
 * Returns undefined if any step is missing.
 */
export function getAtPath(obj: unknown, path: string): unknown {
    if (obj === null || obj === undefined || !path) return undefined
    const parts = path.split(".")
    let cur: unknown = obj
    for (const p of parts) {
        if (cur === null || cur === undefined) return undefined
        if (typeof cur !== "object") return undefined
        cur = (cur as Record<string, unknown>)[p]
    }
    return cur
}

/**
 * Try to find `path` somewhere inside a trace envelope. Handles every shape
 * we've seen in the wild:
 *   - `{spans: {<rootSpanName>: span}}`   — bulk /tracing/spans/query
 *   - `{spans: [span, ...]}`              — array form (some endpoints)
 *   - `{response: {tree: [...]}}`         — agenta-format wrapped response
 *   - the envelope IS the span             — endpoint-stripped form
 *
 * For each candidate span found, the path is walked first directly, then
 * recursively through `spans` (record OR array) and `children` (array).
 * Returns the FIRST non-undefined match (DFS, depth-first).
 */
export function findInTrace(trace: unknown, path: string): unknown {
    if (!trace || typeof trace !== "object") return undefined

    // 1. Path might resolve directly on the envelope (rare but cheap to try).
    const direct = getAtPath(trace, path)
    if (direct !== undefined) return direct

    const t = trace as Record<string, unknown>

    // 2. {spans: {name: span, ...}} or {spans: [span, ...]}
    const spans = t.spans
    if (spans !== undefined) {
        const v = walkSpanCollection(spans, path)
        if (v !== undefined) return v
    }

    // 3. {count, traces: {[traceIdNoDashes]: traceData}} — the
    //    TracesApiResponse envelope written by `prefetchTracesByIds`.
    //    Drill into each inner trace and walk it as its own envelope.
    //    Kept distinct from step 2 because the value shape under `traces`
    //    is a full trace object (with its own `spans`/`response`/etc.),
    //    not a span collection — so we recurse via findInTrace, not via
    //    walkSpanCollection.
    if (typeof t.count === "number" && t.traces && typeof t.traces === "object") {
        for (const inner of Object.values(t.traces as Record<string, unknown>)) {
            const v = findInTrace(inner, path)
            if (v !== undefined) return v
        }
    }

    // 4. {response: {tree: [...]}} (agenta format from single-trace endpoint)
    const response = t.response
    if (response && typeof response === "object") {
        const tree = (response as Record<string, unknown>).tree
        if (Array.isArray(tree)) {
            for (const node of tree) {
                const v = walkSpan(node, path)
                if (v !== undefined) return v
            }
        }
    }

    // 5. Envelope itself might BE a span (already stripped).
    const v = walkSpan(t, path)
    if (v !== undefined) return v

    return undefined
}

function walkSpanCollection(collection: unknown, path: string): unknown {
    if (collection === null || collection === undefined) return undefined
    if (Array.isArray(collection)) {
        for (const c of collection) {
            const v = walkSpan(c, path)
            if (v !== undefined) return v
        }
        return undefined
    }
    if (typeof collection === "object") {
        for (const k of Object.keys(collection as Record<string, unknown>)) {
            const v = walkSpan((collection as Record<string, unknown>)[k], path)
            if (v !== undefined) return v
        }
    }
    return undefined
}

function walkSpan(span: unknown, path: string): unknown {
    if (!span || typeof span !== "object") return undefined
    const direct = getAtPath(span, path)
    if (direct !== undefined) return direct
    const obj = span as Record<string, unknown>
    // Recurse into nested span containers
    if (obj.spans !== undefined) {
        const v = walkSpanCollection(obj.spans, path)
        if (v !== undefined) return v
    }
    if (Array.isArray(obj.children)) {
        for (const c of obj.children) {
            const v = walkSpan(c, path)
            if (v !== undefined) return v
        }
    }
    if (Array.isArray(obj.nodes)) {
        for (const c of obj.nodes) {
            const v = walkSpan(c, path)
            if (v !== undefined) return v
        }
    }
    return undefined
}

/**
 * Resolver for `input`-type steps. Reads from the joined testcase.
 *
 * Path is a dot-path on the testcase object (e.g. `data.country` →
 * `testcase.data.country`). The hydrate transform already joined the testcase
 * by `scenario.testcase_id ∪ result.testcase_id`, so we don't need to refetch.
 */
export const resolveFromTestcase: StepResolver = ({row, path}) => {
    if (!row.testcase) return null
    const value = getAtPath(row.testcase, path)
    if (value === undefined) return null
    return {value, source: "testcase"}
}

/**
 * Resolver that walks a trace by trace_id from the step's result. Works for
 * any step type whose data is span-resident (e.g. `invocation`, sometimes
 * `annotation`).
 */
export const resolveFromTrace: StepResolver = ({result, row, path}) => {
    if (!result?.trace_id) return null
    const trace = row.traces[result.trace_id]
    if (trace === undefined) return null
    const value = findInTrace(trace, path)
    if (value === undefined) return null
    return {value, source: "trace"}
}

/**
 * String-typed evaluator outputs (e.g. an LLM-judge's `reasoning` field) are
 * stored in metric data as a `{type: "string", count: N}` placeholder rather
 * than the actual string — the backend can't build a distribution over
 * arbitrary text, so it only records that *some* string was emitted. The
 * real value lives on the annotation trace and is resolved via
 * `resolveFromTrace` instead.
 *
 * Detect that exact shape (`type: "string"` + numeric `count`, no
 * distribution / scalar fields) so `resolveFromMetric` can return `null`
 * and let the composed `resolveFromTrace` fallback take over. Mirrors the
 * legacy `isStringTypePlaceholder` check in
 * `EvalRunDetails/atoms/scenarioColumnValues.ts`.
 */
function isStringTypeMetricPlaceholder(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false
    const obj = value as Record<string, unknown>
    if (obj.type !== "string" || typeof obj.count !== "number") return false
    return (
        obj.value === undefined &&
        obj.freq === undefined &&
        obj.frequency === undefined &&
        obj.rank === undefined &&
        obj.mean === undefined
    )
}

/**
 * Resolver that reads from `metric.data[step.key][path]`.
 *
 * Metric.data is `{stepKey: {flatAttributePath: valueOrStatsObject}}`. The
 * `flatAttributePath` IS the mapping's `step.path` as a SINGLE STRING KEY
 * (not a dot-walk). That matches what the server emits — paths like
 * `"attributes.ag.data.outputs.success"` are baked-in flat keys, not nested
 * objects. Trying to dot-walk would fail.
 *
 * Returns `null` (not the placeholder) for string-typed metric outputs so
 * the composed `resolveFromTrace` fallback can extract the actual string
 * from the annotation trace.
 */
export const resolveFromMetric: StepResolver = ({step, row, path}) => {
    for (const m of row.metrics) {
        const data = m.data as Record<string, unknown> | undefined
        if (!data) continue
        const bucket = data[step.key] as Record<string, unknown> | undefined
        if (bucket && bucket[path] !== undefined) {
            const value = bucket[path]
            if (isStringTypeMetricPlaceholder(value)) return null
            return {value, source: "metric"}
        }
    }
    return null
}

/**
 * Compose strategies — try each in order, return the first non-null.
 */
export function composeResolvers(...resolvers: StepResolver[]): StepResolver {
    return (ctx) => {
        for (const r of resolvers) {
            const out = r(ctx)
            if (out !== null) return out
        }
        return null
    }
}

// ============================================================================
// Grouping — infer the namespace each column should display under
// ============================================================================

/**
 * Title-case a slug for display. "exact-match" → "Exact Match".
 * Best-effort — callers that have the actual entity name should use that.
 */
function slugToTitle(slug: string | null | undefined): string {
    if (!slug) return ""
    return slug
        .split(/[-_]/)
        .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
        .join(" ")
}

/**
 * Detect "Metrics" columns — paths under `attributes.ag.metrics.*`. These
 * cross-cut the step-type grouping: an `attributes.ag.metrics.tokens...`
 * column on an invocation step still belongs to the "Metrics" group, not
 * "Application", because the UI surfaces them together.
 */
function isMetricsPath(path: string): boolean {
    return /(^|\.)attributes\.ag\.metrics(\.|$)/.test(path)
}

/**
 * Compute a column's ColumnGroup from its step + mapping path. Exported so
 * consumers (the PoC, custom renderers) can run grouping standalone if they
 * don't need the resolved values.
 */
export function computeColumnGroup(step: RunStep | null, path: string): ColumnGroup {
    const refs = step?.references ?? null

    // Metrics paths override step-type — they go under "Metrics".
    if (path && isMetricsPath(path)) {
        return {
            kind: "metrics",
            slug: null,
            label: "Metrics",
            key: "metrics",
            refs,
        }
    }

    if (!step) {
        return {kind: "other", slug: null, label: "(no step)", key: "other:none", refs: null}
    }

    switch (step.type) {
        case "input": {
            // Prefer the testset's slug (stable across revisions); fall back
            // to testset_revision.slug then the step.key.
            const testsetSlug = refs?.testset?.slug ?? refs?.testset_revision?.slug ?? null
            const slug = testsetSlug
            return {
                kind: "testset",
                slug,
                // The UI shows the testset's display name (e.g. "testset-large"). Without
                // fetching the testset entity we don't have the name — fall back to slug.
                // Renderers with access to the testset entity should override the label.
                label: slug ? `Testset ${slug}` : "Testset",
                key: `testset:${slug ?? step.key}`,
                refs,
            }
        }

        case "invocation": {
            const appSlug = refs?.application?.slug ?? refs?.application_revision?.slug ?? null
            return {
                kind: "application",
                slug: appSlug,
                label: appSlug ? `Application ${appSlug}` : "Application",
                key: `application:${appSlug ?? step.key}`,
                refs,
            }
        }

        case "annotation": {
            // Each evaluator step gets its own group — that's the whole point.
            // Two evaluators emitting the same column name (e.g. "success")
            // remain disambiguated as long as their evaluator slugs differ.
            const evaluatorSlug = refs?.evaluator?.slug ?? refs?.evaluator_revision?.slug ?? null
            return {
                kind: "evaluator",
                slug: evaluatorSlug,
                label: evaluatorSlug ? slugToTitle(evaluatorSlug) : "Evaluator",
                key: `evaluator:${evaluatorSlug ?? step.key}`,
                refs,
            }
        }

        default:
            return {
                kind: "other",
                slug: null,
                label: `(${step.type})`,
                key: `other:${step.type}`,
                refs,
            }
    }
}

// ============================================================================
// Default registry — keyed by step.type
//
// Add a new step type by passing `customResolvers` to `resolveMappings`.
// Do NOT edit the entries below to handle new shapes; extend instead.
// ============================================================================

export const DEFAULT_STEP_RESOLVERS: Record<string, StepResolver> = {
    /**
     * Input steps carry testcase references on their result. Mappings point
     * at testcase fields via `data.<column>`.
     */
    input: resolveFromTestcase,

    /**
     * Invocation steps (app calls) have a trace per result. Mappings point at
     * `attributes.ag.data.*` paths on the trace's spans.
     */
    invocation: resolveFromTrace,

    /**
     * Annotation steps (evaluator results) are dual-source: metrics carry the
     * pre-aggregated value keyed by step.key + flat path, AND there's an
     * annotation trace at result.trace_id. Try metric first (cheaper) then
     * fall back to trace.
     */
    annotation: composeResolvers(resolveFromMetric, resolveFromTrace),
}

// ============================================================================
// Public entry point
// ============================================================================

export interface ResolveMappingsOptions {
    /**
     * Override or extend the per-step-type resolver registry. Pass a partial
     * record — keys not provided fall through to `DEFAULT_STEP_RESOLVERS`.
     *
     * Use this to support custom step types or override behaviour for known
     * ones (e.g. force `annotation` to skip the metric lookup).
     */
    customResolvers?: Record<string, StepResolver>
    /**
     * Fallback resolver invoked when no per-type strategy is registered. By
     * default returns `null`. Override to e.g. inspect `result.data` directly.
     */
    fallbackResolver?: StepResolver
}

/**
 * Resolve all UI columns for a single hydrated row, per the run's mappings.
 *
 * Inputs:
 *   - `row`        the joined entities (scenario + results + metrics + testcase + traces)
 *   - `schema`     run.data.steps + run.data.mappings (the materialization spec)
 *   - `options`    optional custom resolvers
 *
 * Output: one `ResolvedColumn` per mapping, in the original order. Columns
 * that couldn't be resolved have `value: undefined` and `source: "missing"`.
 */
export function resolveMappings<TScenario extends HydratableScenario>(
    row: HydratedScenarioRow<TScenario>,
    schema: RunSchema,
    options: ResolveMappingsOptions = {},
): ResolvedColumn[] {
    const resolvers: Record<string, StepResolver> = {
        ...DEFAULT_STEP_RESOLVERS,
        ...(options.customResolvers ?? {}),
    }

    const stepByKey = new Map<string, RunStep>()
    for (const s of schema.steps) stepByKey.set(s.key, s)

    return schema.mappings.map((m) => {
        const kind = m.column?.kind ?? "?"
        const name = m.column?.name ?? "?"
        const stepKey = m.step?.key ?? ""
        const path = m.step?.path ?? ""
        const step = stepByKey.get(stepKey) ?? null
        const group = computeColumnGroup(step, path)

        if (!step) {
            return {
                name,
                kind,
                stepKey,
                stepType: "?",
                path,
                value: undefined,
                source: "missing",
                group,
            }
        }

        const result = (row.results as EvaluationResult[]).find((r) => r.step_key === stepKey)
        const resolver = resolvers[step.type] ?? options.fallbackResolver ?? null

        if (!resolver) {
            return {
                name,
                kind,
                stepKey,
                stepType: step.type,
                path,
                value: undefined,
                source: `missing (no resolver for step.type="${step.type}")`,
                group,
            }
        }

        const out = resolver({
            step,
            result,
            row: row as HydratedScenarioRow<HydratableScenario>,
            path,
        })
        if (out === null) {
            return {
                name,
                kind,
                stepKey,
                stepType: step.type,
                path,
                value: undefined,
                source: "missing",
                group,
            }
        }
        return {
            name,
            kind,
            stepKey,
            stepType: step.type,
            path,
            value: out.value,
            source: out.source,
            group,
        }
    })
}

/**
 * Group resolved columns by their `group.key`, preserving the ORIGINAL
 * mapping order within each group. Use this when rendering UI that mirrors
 * the screenshot's grouped-header layout.
 *
 * Group ordering: testset groups first, then application groups, then
 * evaluator groups (in their first-appearance order), then metrics, then
 * other. Within a kind, groups appear in the order their columns first
 * appear in the mapping list.
 */
export interface ResolvedColumnGroup {
    group: ColumnGroup
    columns: ResolvedColumn[]
}

export function groupResolvedColumns(columns: ResolvedColumn[]): ResolvedColumnGroup[] {
    const groupsByKey = new Map<string, ResolvedColumnGroup>()
    const firstAppearance = new Map<string, number>()

    columns.forEach((col, idx) => {
        const existing = groupsByKey.get(col.group.key)
        if (existing) {
            existing.columns.push(col)
        } else {
            groupsByKey.set(col.group.key, {group: col.group, columns: [col]})
            firstAppearance.set(col.group.key, idx)
        }
    })

    // Kind ordering matches the UI's left-to-right layout in the screenshot.
    const kindOrder: ColumnGroup["kind"][] = [
        "testset",
        "application",
        "evaluator",
        "metrics",
        "other",
    ]
    const kindRank = (k: ColumnGroup["kind"]) => {
        const idx = kindOrder.indexOf(k)
        return idx === -1 ? kindOrder.length : idx
    }

    return Array.from(groupsByKey.values()).sort((a, b) => {
        const kindCmp = kindRank(a.group.kind) - kindRank(b.group.kind)
        if (kindCmp !== 0) return kindCmp
        // Within a kind, preserve first-appearance order
        return (firstAppearance.get(a.group.key) ?? 0) - (firstAppearance.get(b.group.key) ?? 0)
    })
}

// ============================================================================
// Pre-resolution column grouping — group raw mappings by source.
//
// `groupResolvedColumns` above groups columns AFTER a row's values are
// resolved. `groupRunColumns` works directly off the run schema
// (steps + mappings), so the UI can build column headers before any
// scenario data is hydrated.
// ============================================================================

/** A single UI column leaf, before value resolution. */
export interface RunColumnLeaf {
    /** Column display name (from `mapping.column.name`). */
    name: string
    /** Source category — testset / application / evaluator / metrics / other. */
    kind: ColumnGroup["kind"]
    /** The owning group's slug (null for metrics and some "other" groups). */
    groupSlug: string | null
}

/** A group of UI columns sharing a `ColumnGroup` — one nested header. */
export interface RunColumnGroup {
    group: ColumnGroup
    columns: RunColumnLeaf[]
}

/**
 * Group a run's raw column mappings by source — testset / application /
 * evaluator(s) / metrics / other.
 *
 * "other"-kind columns (steps with an unrecognised type, or mappings with
 * no resolvable step) are **included**. They are real columns the
 * backend-metadata column path also surfaces — dropping them would
 * silently shrink the visible column set.
 *
 * Internal dedup keys (column names containing `_dedup_id`, e.g.
 * `testcase_dedup_id`) are **excluded** — they are not user-facing
 * columns. The backend-metadata column path drops them too.
 *
 * Group order: testset → application → evaluator(s) → metrics → other.
 * Within a kind, groups appear in the order their columns first appear in
 * the mapping list (matching `groupResolvedColumns`).
 */
export function groupRunColumns(steps: RunStep[], mappings: RunMapping[]): RunColumnGroup[] {
    const stepByKey = new Map<string, RunStep>()
    for (const s of steps) stepByKey.set(s.key, s)

    const byKey = new Map<string, RunColumnGroup>()
    const firstAppearance = new Map<string, number>()

    mappings.forEach((mapping, idx) => {
        const columnName = mapping.column?.name
        if (typeof columnName !== "string" || !columnName) return
        // Internal dedup keys are not user-facing columns.
        if (columnName.includes("_dedup_id")) return
        const step = mapping.step?.key ? (stepByKey.get(mapping.step.key) ?? null) : null
        const path = mapping.step?.path ?? ""
        const group = computeColumnGroup(step, path)

        let slot = byKey.get(group.key)
        if (!slot) {
            slot = {group, columns: []}
            byKey.set(group.key, slot)
            firstAppearance.set(group.key, idx)
        }
        slot.columns.push({name: columnName, kind: group.kind, groupSlug: group.slug})
    })

    const kindOrder: Record<ColumnGroup["kind"], number> = {
        testset: 0,
        application: 1,
        evaluator: 2,
        metrics: 3,
        other: 4,
    }
    return Array.from(byKey.values()).sort((a, b) => {
        const k = kindOrder[a.group.kind] - kindOrder[b.group.kind]
        if (k !== 0) return k
        return (firstAppearance.get(a.group.key) ?? 0) - (firstAppearance.get(b.group.key) ?? 0)
    })
}
