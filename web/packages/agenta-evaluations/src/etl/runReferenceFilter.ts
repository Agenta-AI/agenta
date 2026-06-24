/**
 * Run-list predicate filter — the run-level counterpart to rowPredicateFilter.
 *
 * # Where this fits
 *
 * `rowPredicateFilter` drops scenario ROWS *within a single run* by their
 * resolved cell values (an evaluator's `success`, a testset column, a metric).
 * This module drops whole RUNS *from a run list* by the **role** their
 * references play.
 *
 * The canonical use is the unification behind feature "F": an evaluator's
 * Evaluations / Overview tab should show the evaluations that *evaluated this
 * workflow* — runs where the visited workflow is the run's **subject** (its
 * `application` / invocation reference) — NOT runs that merely *used* it as a
 * grader (where it sits in an `evaluator` / annotation reference).
 *
 * The backend reference filter (`references @> [...]`) matches an id in *any*
 * role, so `application = evaluatorId` over-returns: it also matches runs where
 * the evaluator was a grader. That's harmless for apps (an app id only ever
 * occupies the `application` role) but leaks for evaluators (their id occupies
 * `evaluator` on every run they grade, and `application` on their own subject
 * runs). This filter resolves the role from the run's structure and keeps the
 * intended one.
 *
 * # Why structural, not `meta.application`
 *
 * The run carries a denormalized `meta.application` hint, but it's unreliable
 * (absent on some runs) — a null hint silently bypasses any `meta`-based
 * filter, which is exactly how grader runs slip through today. The run's
 * `data.steps` are the source of truth: the invocation step's `application`
 * reference is the evaluated/subject workflow, regardless of `meta`.
 *
 * # Role convention
 *
 * Same `step.type → role` mapping `resolveMappings` / `predicateToEntitySlices`
 * use on the read side:
 *
 *   input       → testset
 *   invocation  → application   (the evaluated / subject workflow)
 *   annotation  → evaluator     (the grader)
 *
 * References are already role-keyed off each step
 * (`{application: {id}}`, `{evaluator: {id, slug}}`, …); `step.type` is only a
 * fallback for legacy steps whose single reference wasn't explicitly keyed.
 *
 * @packageDocumentation
 */

import type {Chunk, Transform} from "@agenta/entities/etl"

/**
 * Minimal structural shape of a run step — intentionally looser than
 * `RunSchema`'s `RunStep` so callers can pass `previewMeta.steps[]`
 * (whose `references` is typed `Record<string, unknown>`) without a cast.
 */
export interface RunReferenceStep {
    type?: string | null
    references?: Record<string, unknown> | null
}

/** A reference role a run step can carry. Open string for forward-compat. */
export type RunReferenceRole = "application" | "evaluator" | "testset" | "query" | (string & {})

/**
 * `step.type → canonical role`. Used only as a fallback when a step's
 * references aren't explicitly role-keyed (legacy single-reference steps).
 */
const STEP_TYPE_TO_ROLE: Record<string, RunReferenceRole> = {
    input: "testset",
    invocation: "application",
    annotation: "evaluator",
}

/**
 * One run-level clause: the run must (op "eq") or must not (op "ne") carry
 * `id` in the given `role`.
 *
 *   - `role` — which reference slot the id must occupy ("application" = subject).
 *   - `id` — the id (or slug) to match.
 *   - `op` — "eq" → run HAS the id in this role; "ne" → run does NOT. Default "eq".
 */
export interface RunReferencePredicate {
    role: RunReferenceRole
    id: string
    op?: "eq" | "ne"
}

function addRefKeys(ref: unknown, into: Set<string>): void {
    if (!ref || typeof ref !== "object") return
    const {id, slug} = ref as {id?: unknown; slug?: unknown}
    if (typeof id === "string" && id) into.add(id)
    // Evaluators are frequently referenced by slug rather than id, so match both.
    if (typeof slug === "string" && slug) into.add(slug)
}

/**
 * Collect every id/slug a given `role` occupies across a run's steps.
 *
 * Primary path: the role-keyed reference on each step (`refs[role]`). Fallback:
 * a legacy step whose `references` isn't role-keyed but whose `step.type` maps
 * to `role` and which carries exactly one reference.
 */
export function collectRoleReferenceKeys(
    steps: readonly RunReferenceStep[] | null | undefined,
    role: RunReferenceRole,
): Set<string> {
    const keys = new Set<string>()
    if (!Array.isArray(steps)) return keys

    for (const step of steps) {
        const refs = step?.references
        if (!refs || typeof refs !== "object") continue
        const map = refs as Record<string, unknown>

        const direct = map[role]
        if (direct) {
            addRefKeys(direct, keys)
            continue
        }

        // Legacy fallback: references not explicitly role-keyed, but step.type
        // identifies the role and the step carries a single reference.
        const inferred = step?.type ? STEP_TYPE_TO_ROLE[String(step.type)] : undefined
        if (inferred === role) {
            const values = Object.values(map)
            if (values.length === 1) addRefKeys(values[0], keys)
        }
    }

    return keys
}

/** Evaluate a single run-reference predicate against a run's steps. */
export function evaluateRunReferencePredicate(
    predicate: RunReferencePredicate,
    steps: readonly RunReferenceStep[] | null | undefined,
): boolean {
    const has = collectRoleReferenceKeys(steps, predicate.role).has(predicate.id)
    return (predicate.op ?? "eq") === "ne" ? !has : has
}

/**
 * True when `workflowId` is the run's evaluated / subject workflow — i.e. the
 * workflow sits in an `application` (invocation) reference. This is the
 * "evaluations that evaluated THIS workflow" predicate.
 */
export function isSubjectRun(
    steps: readonly RunReferenceStep[] | null | undefined,
    workflowId: string,
): boolean {
    return evaluateRunReferencePredicate({role: "application", id: workflowId}, steps)
}

/**
 * Whether a run carries any resolvable `application` (subject) reference at all.
 *
 * Used as a safety guard: a run with no resolvable subject can't be classified
 * structurally, so the caller should fall back to its prior heuristic
 * (e.g. `meta.application`) rather than silently dropping the run.
 */
export function hasResolvableSubject(
    steps: readonly RunReferenceStep[] | null | undefined,
): boolean {
    return collectRoleReferenceKeys(steps, "application").size > 0
}

// ============================================================================
// ETL Transform parity
//
// The dataset-store fetch path consumes the pure helpers above directly, but
// for headless / chunked ETL runs we expose a Transform factory mirroring
// rowPredicateFilter's `makePredicateGroupFilter`. Predicates are AND-joined.
// ============================================================================

export interface RunReferenceFilterOptions<TRow> {
    /** One or more predicates, AND-joined. All must hold for the run to pass. */
    predicates: RunReferencePredicate | RunReferencePredicate[]
    /** Extract the run's steps from a row. Defaults to `row.previewMeta?.steps` / `row.steps`. */
    getSteps?: (row: TRow) => readonly RunReferenceStep[] | null | undefined
    /** Optional per-chunk telemetry — feeds a hit-ratio meter. */
    onChunkFiltered?: (info: {chunk: number; scanned: number; matched: number}) => void
}

function defaultGetSteps(row: unknown): readonly RunReferenceStep[] | null | undefined {
    if (!row || typeof row !== "object") return null
    const r = row as {steps?: unknown; previewMeta?: {steps?: unknown}}
    if (Array.isArray(r.steps)) return r.steps as RunReferenceStep[]
    if (Array.isArray(r.previewMeta?.steps)) return r.previewMeta!.steps as RunReferenceStep[]
    return null
}

/** True when a run's steps satisfy every supplied predicate (logical AND). */
export function matchesRunReferenceFilter(
    predicates: RunReferencePredicate | RunReferencePredicate[],
    steps: readonly RunReferenceStep[] | null | undefined,
): boolean {
    const list = Array.isArray(predicates) ? predicates : [predicates]
    return list.every((p) => evaluateRunReferencePredicate(p, steps))
}

/**
 * Build a `Transform<TRow, TRow>` that keeps only runs satisfying every
 * supplied predicate. Stateless — reusable across pipeline runs.
 */
export function makeRunReferenceFilter<TRow>(
    options: RunReferenceFilterOptions<TRow>,
): Transform<TRow, TRow> {
    const predicates = Array.isArray(options.predicates) ? options.predicates : [options.predicates]
    const getSteps =
        options.getSteps ?? (defaultGetSteps as RunReferenceFilterOptions<TRow>["getSteps"])!
    let chunkIdx = 0

    return (chunk: Chunk<TRow>) => {
        chunkIdx++
        const passing = chunk.items.filter((row) =>
            matchesRunReferenceFilter(predicates, getSteps(row)),
        )
        options.onChunkFiltered?.({
            chunk: chunkIdx,
            scanned: chunk.items.length,
            matched: passing.length,
        })
        return {...chunk, items: passing}
    }
}
