export type EvaluationRunKind = "auto" | "human" | "online" | "custom"

export interface EvaluationRunStepForKindDetection {
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

export interface EvaluationRunForKindDetection {
    id: string
    data?: {
        steps?: EvaluationRunStepForKindDetection[] | null
    } | null
    flags?: {
        isLive?: boolean | null
        is_live?: boolean | null
    } | null
    meta?: {
        source?: string | null
    } | null
}

const isOnlineEvaluation = (run: EvaluationRunForKindDetection | null | undefined): boolean => {
    if (!run) return false

    const flags = run.flags ?? {}
    if (flags.isLive === true || flags.is_live === true) {
        return true
    }

    const source = typeof run.meta?.source === "string" ? run.meta.source.toLowerCase() : null
    return source === "online_evaluation_drawer"
}

const isHumanEvaluation = (run: EvaluationRunForKindDetection | null | undefined): boolean => {
    if (!run || isOnlineEvaluation(run)) return false

    const steps = Array.isArray(run.data?.steps) ? run.data.steps : []
    return steps.some((step) => {
        const type = step?.type ?? step?.stepType ?? step?.kind
        if (type !== "annotation") return false

        const origin = step?.origin ?? step?.step_role ?? step?.stepRole
        return origin === "human"
    })
}

const isCustomEvaluation = (run: EvaluationRunForKindDetection | null | undefined): boolean => {
    if (!run || isOnlineEvaluation(run)) return false

    const steps = Array.isArray(run.data?.steps) ? run.data.steps : []
    return steps.some((step) => {
        const origin = step?.origin ?? step?.step_role ?? step?.stepRole
        const type = step?.type ?? step?.stepType ?? step?.kind

        return origin === "custom" || type === "custom" || step?.metadata?.origin === "custom"
    })
}

export const deriveEvaluationKind = (
    run: EvaluationRunForKindDetection | null | undefined,
): EvaluationRunKind => {
    if (isOnlineEvaluation(run)) return "online"
    if (isHumanEvaluation(run)) return "human"
    if (isCustomEvaluation(run)) return "custom"
    return "auto"
}
