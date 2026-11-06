/**
 * Run comparison rules, copied from the old app as pure functions: the `?compare=` URL value
 * (`EvalRunDetails/state/urlCompare.ts`), the run structure and the "can this run be compared"
 * check (`EvalRunDetails/atoms/compare.ts`), and the candidate rule of `CompareRunsMenu.tsx`.
 *
 * @packageDocumentation
 */

/** The old app compares a run with at most 4 others. */
export const MAX_COMPARISON_RUNS = 4

export const COMPARE_QUERY_KEY = "compare"

/** `?compare=a,b&compare=c` -> ["a", "b", "c"]; blanks are dropped. */
export function parseCompareParam(value: string | readonly string[] | null | undefined): string[] {
    if (!value) return []
    const parts = typeof value === "string" ? [value] : value
    return parts
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
}

/** The `compare` query value for these ids, or null to remove it. */
export const compareParamValue = (ids: readonly string[]): string | null =>
    ids.length ? ids.join(",") : null

/** Add or remove a compared run; adding past the limit changes nothing. */
export function toggleCompareRun(ids: readonly string[], runId: string): string[] {
    if (ids.includes(runId)) return ids.filter((id) => id !== runId)
    if (ids.length >= MAX_COMPARISON_RUNS) return [...ids]
    return [...ids, runId]
}

interface CompareStep {
    key?: string
    type?: string | null
    references?: Record<string, unknown> | null
}

export interface CompareRunInput {
    id: string
    status?: string | null
    data?: {steps?: readonly CompareStep[] | null} | null
}

export interface RunComparisonStructure {
    testsetIds: string[]
    hasQueryInput: boolean
    inputStepCount: number
    /** Evaluator ids (else slugs) of the annotation steps. */
    evaluatorIds: string[]
}

const refId = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined
    const ref = value as {id?: unknown; slug?: unknown}
    return typeof ref.id === "string" ? ref.id : undefined
}

const refIdOrSlug = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined
    const ref = value as {id?: unknown; slug?: unknown}
    if (typeof ref.id === "string") return ref.id
    return typeof ref.slug === "string" ? ref.slug : undefined
}

/** The test sets, the evaluators and the kind of input of a run, from its steps. */
export function runComparisonStructure(run: CompareRunInput): RunComparisonStructure {
    const testsetIds = new Set<string>()
    const evaluatorIds = new Set<string>()
    let hasQueryInput = false
    let inputStepCount = 0
    for (const step of run.data?.steps ?? []) {
        const refs = step.references ?? {}
        if (step.type === "input") {
            inputStepCount += 1
            if (refs.query || refs.query_revision || refs.query_variant) hasQueryInput = true
            const testsetId = refId(refs.testset)
            if (testsetId) testsetIds.add(testsetId)
        } else if (step.type === "annotation") {
            const evaluatorId = refIdOrSlug(refs.evaluator)
            if (evaluatorId) evaluatorIds.add(evaluatorId)
        }
    }
    return {
        testsetIds: [...testsetIds],
        hasQueryInput,
        inputStepCount,
        evaluatorIds: [...evaluatorIds],
    }
}

/** Statuses of a finished run, in which a run can be compared. */
const COMPARABLE_STATUSES = new Set([
    "success",
    "failure",
    "failed",
    "errors",
    "cancelled",
    "completed",
    "finished",
    "ok",
    "evaluation_finished",
    "evaluation_finished_with_errors",
    "evaluation_failed",
    "evaluation_aggregation_failed",
])

export type CompareBlockReason = "pending-status" | "no-input" | "no-testset" | "query-input"

/**
 * Whether a run can be compared, and why not: it must have finished, have an input step, run on a
 * test set, and not read a live query.
 */
export function compareBlockReason(run: CompareRunInput): CompareBlockReason | null {
    if (!run.status || !COMPARABLE_STATUSES.has(run.status.toLowerCase())) return "pending-status"
    const structure = runComparisonStructure(run)
    if (structure.inputStepCount === 0) return "no-input"
    if (structure.testsetIds.length === 0) return "no-testset"
    if (structure.hasQueryInput) return "query-input"
    return null
}

/**
 * The runs that can be compared with `base`: other comparable runs that share a test set and an
 * evaluator with it.
 */
export function compareCandidates<T extends CompareRunInput>(
    base: CompareRunInput,
    runs: readonly T[],
): T[] {
    if (compareBlockReason(base)) return []
    const baseStructure = runComparisonStructure(base)
    const testsets = new Set(baseStructure.testsetIds)
    const evaluators = new Set(baseStructure.evaluatorIds)
    return runs.filter((run) => {
        if (run.id === base.id || compareBlockReason(run)) return false
        const structure = runComparisonStructure(run)
        return (
            structure.testsetIds.some((id) => testsets.has(id)) &&
            structure.evaluatorIds.some((id) => evaluators.has(id))
        )
    })
}
