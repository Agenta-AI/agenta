/**
 * Per-context hit-ratio meter for the run-list SUBJECT predicate (feature F).
 *
 * The subject filter (`fetchAutoEvaluationRuns`) keeps runs that *evaluated the
 * scoped workflow* and drops runs where it was only a grader. When the scoped
 * workflow is graded far more often than it's evaluated, most fetched runs get
 * dropped client-side — the "low hit-ratio" case the eval-filtering RFC's meter
 * is built to detect (docs/designs/eval-filtering.md §D2 + §C3).
 *
 * A low rolling ratio is the signal that the backend role-aware reference
 * filter (v2) is warranted. The FE already encodes the role as the reference
 * payload's dict key; v2 is purely the backend honoring it
 * (`evaluations/utils.py` `query_run_references` — see line 66). So this meter
 * **reports the regime** (dev log + a readable getter for diagnostics); it does
 * not — and cannot, from the FE — swap to a server-side filter.
 *
 * Meters are keyed by the subject-filter context (project + scoped workflow ids
 * + kind). Each distinct context gets its own rolling window.
 */

import {
    createHitRatioMeter,
    type HitRatioMeter,
    type HitRatioRegime,
} from "@agenta/entities/evaluationRun/etl"

const meters = new Map<string, HitRatioMeter>()

const meterFor = (signature: string): HitRatioMeter => {
    let meter = meters.get(signature)
    if (!meter) {
        meter = createHitRatioMeter()
        meters.set(signature, meter)
    }
    return meter
}

/** Stable signature for a subject-filter context. */
export const subjectFilterSignature = ({
    projectId,
    appIds,
    evaluationKind,
}: {
    projectId: string | null
    appIds: string[] | null | undefined
    evaluationKind: string
}): string => `${projectId ?? "null"}::${(appIds ?? []).join("|")}::${evaluationKind}`

/**
 * Record one page of subject-filter stats and return the resulting regime.
 *
 * `page` should be the fetch offset (monotonic, unique per page within a
 * context). The meter dedups by it, so a refetch from offset 0 — common after
 * cache invalidation — doesn't double-count.
 */
export const recordSubjectFilterPage = ({
    signature,
    page,
    scanned,
    matched,
}: {
    signature: string
    page: number
    scanned: number
    matched: number
}): HitRatioRegime => {
    const meter = meterFor(signature)
    meter.record({chunk: page, scanned, matched})
    return meter.regime()
}

/** Read the current regime without recording (diagnostics / banners). */
export const getSubjectFilterRegime = (signature: string): HitRatioRegime | null =>
    meters.get(signature)?.regime() ?? null

/** Drop a context's meter (e.g. when its filter signature is retired). */
export const resetSubjectFilterMeter = (signature: string): void => {
    meters.delete(signature)
}
