/**
 * Centralized utility for determining evaluation run kind based on run.data.steps.
 *
 * IMPORTANT: Do NOT use `run.meta.evaluation_kind` to determine the evaluation type.
 * That field is flaky and unreliable - some runs have it, some don't.
 *
 * Instead, derive the kind from `run.data.steps` by examining step types and origins:
 * - "human": Has annotation steps with origin="human"
 * - "online": Has flags.isLive=true OR meta.source="online_evaluation_drawer"
 * - "custom": Has steps with origin="custom" or type="custom"
 * - "auto": Default fallback for automated evaluations
 */

export type EvaluationRunKind = "auto" | "human" | "online" | "custom"

/**
 * Minimal step structure needed for kind detection.
 * Supports both snake_case (raw API) and camelCase (transformed) formats.
 */
export interface EvaluationStepForKindDetection {
    key?: string | null
    type?: string | null
    stepType?: string | null
    kind?: string | null
    origin?: string | null
    step_role?: string | null
    stepRole?: string | null
    metadata?: {
        origin?: string | null
    } | null
}

/**
 * Minimal run structure needed for kind detection.
 * Supports both snake_case (raw API) and camelCase (transformed) formats.
 */
export interface EvaluationRunForKindDetection {
    data?: {
        steps?: EvaluationStepForKindDetection[] | null
    } | null
    flags?: {
        isLive?: boolean | null
        is_live?: boolean | null
    } | null
    meta?: {
        source?: string | null
    } | null
}

/**
 * Check if a run is an online/live evaluation.
 * Online evaluations have flags.isLive=true OR meta.source="online_evaluation_drawer"
 */
export const isOnlineEvaluation = (
    run: EvaluationRunForKindDetection | null | undefined,
): boolean => {
    if (!run) return false

    const flags = run.flags ?? {}
    if (flags.isLive === true || flags.is_live === true) {
        return true
    }

    const source = typeof run.meta?.source === "string" ? run.meta.source.toLowerCase() : null
    return source === "online_evaluation_drawer"
}

/**
 * Check if a run is a human evaluation.
 * Human evaluations have annotation steps with origin="human".
 * Note: Online evaluations take precedence over human evaluations.
 */
export const isHumanEvaluation = (
    run: EvaluationRunForKindDetection | null | undefined,
): boolean => {
    if (!run) return false
    if (isOnlineEvaluation(run)) return false

    const steps = Array.isArray(run.data?.steps) ? run.data.steps : []
    return steps.some((step) => {
        const type = step?.type ?? step?.stepType ?? step?.kind
        if (type !== "annotation") return false
        const origin = step?.origin ?? step?.step_role ?? step?.stepRole
        return origin === "human"
    })
}

/**
 * Check if a run is a custom/SDK evaluation.
 * Custom evaluations have steps with origin="custom" or type="custom".
 * Note: Online evaluations take precedence over custom evaluations.
 */
export const isCustomEvaluation = (
    run: EvaluationRunForKindDetection | null | undefined,
): boolean => {
    if (!run) return false
    if (isOnlineEvaluation(run)) return false

    const steps = Array.isArray(run.data?.steps) ? run.data.steps : []
    return steps.some((step) => {
        const origin = step?.origin ?? step?.step_role ?? step?.stepRole
        const type = step?.type ?? step?.stepType ?? step?.kind
        if (origin === "custom" || type === "custom") return true
        return Boolean(step?.metadata?.origin === "custom")
    })
}

/**
 * Derive the evaluation kind from run data.
 * This is the primary function to use for determining evaluation type.
 *
 * Priority order:
 * 1. Online (flags.isLive or meta.source)
 * 2. Human (annotation steps with origin="human")
 * 3. Custom (steps with origin="custom" or type="custom")
 * 4. Auto (default fallback)
 *
 * @param run - The evaluation run object (supports both raw and camelCase formats)
 * @returns The derived evaluation kind
 */
export const deriveEvaluationKind = (
    run: EvaluationRunForKindDetection | null | undefined,
): EvaluationRunKind => {
    if (isOnlineEvaluation(run)) return "online"
    if (isHumanEvaluation(run)) return "human"
    if (isCustomEvaluation(run)) return "custom"
    return "auto"
}

/**
 * Normalize a string evaluation kind value to a valid EvaluationRunKind.
 * Returns null if the value is not a valid kind.
 */
export const normalizeEvaluationKindString = (
    value: string | null | undefined,
): EvaluationRunKind | null => {
    if (typeof value !== "string") return null
    const normalized = value.trim().toLowerCase()
    switch (normalized) {
        case "auto":
        case "human":
        case "online":
        case "custom":
            return normalized
        default:
            return null
    }
}

/**
 * Get the evaluation kind for a run, with fallback to meta.evaluation_kind.
 * This function first tries to derive the kind from run.data.steps,
 * and only falls back to meta.evaluation_kind if derivation returns "auto"
 * and meta has a valid kind value.
 *
 * @deprecated Prefer using `deriveEvaluationKind` directly. This function
 * exists only for backward compatibility during migration.
 */
export const getEvaluationKindWithFallback = (
    run: EvaluationRunForKindDetection & {
        meta?: {evaluation_kind?: string | null; evaluationKind?: string | null}
    },
): EvaluationRunKind => {
    const derivedKind = deriveEvaluationKind(run)

    // If we derived a specific kind (not auto), use it
    if (derivedKind !== "auto") {
        return derivedKind
    }

    // Fallback to meta.evaluation_kind only if derivation returned "auto"
    const metaKind = run?.meta?.evaluation_kind ?? run?.meta?.evaluationKind ?? null
    const normalizedMetaKind = normalizeEvaluationKindString(metaKind)

    return normalizedMetaKind ?? "auto"
}
