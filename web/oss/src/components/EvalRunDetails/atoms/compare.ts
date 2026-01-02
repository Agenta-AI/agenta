import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {buildRunIndex, type RunIndex} from "@/oss/lib/evaluations/buildRunIndex"

import {evaluationRunQueryAtomFamily} from "./table/run"
import type {EvaluationRunQueryResult} from "./table/run"

export const MAX_COMPARISON_RUNS = 4

/**
 * Unified color palette for run comparison.
 * Each entry has:
 * - solid: Full color for charts, badges, accents
 * - tint: Light background color for table rows
 */
export const RUN_COMPARISON_PALETTE = [
    {solid: "#3B82F6", tint: "#EFF6FF"}, // Blue
    {solid: "#F97316", tint: "#FFF7ED"}, // Orange
    {solid: "#8B5CF6", tint: "#F5F3FF"}, // Purple
    {solid: "#10B981", tint: "#ECFDF5"}, // Green
    {solid: "#EC4899", tint: "#FDF2F8"}, // Pink
]

/** Light background colors for table row distinction */
export const COMPARISON_COLORS = RUN_COMPARISON_PALETTE.map((c) => c.tint)

/** Solid colors for charts and visual accents */
export const COMPARISON_SOLID_COLORS = RUN_COMPARISON_PALETTE.map((c) => c.solid)

export const getComparisonColor = (index: number) =>
    COMPARISON_COLORS[index] ?? COMPARISON_COLORS[0]

export const getComparisonSolidColor = (index: number) =>
    COMPARISON_SOLID_COLORS[index] ?? COMPARISON_SOLID_COLORS[0]

export const compareRunIdsAtom = atom<string[]>([])
export const compareRunIdsWriteAtom = atom(
    null,
    (get, set, updater: string[] | ((prev: string[]) => string[])) => {
        const prev = get(compareRunIdsAtom)
        const next =
            typeof updater === "function"
                ? (updater as (prev: string[]) => string[])(prev)
                : updater
        set(compareRunIdsAtom, next)
    },
)

export interface RunComparisonStructure {
    testsetIds: string[]
    hasQueryInput: boolean
    inputStepCount: number
    /** Evaluator identifiers (id or slug) for matching runs with shared evaluators */
    evaluatorIds: string[]
}

const extractRefsTestsetId = (refs: Record<string, any> | undefined | null): string | undefined => {
    if (!refs) return undefined
    const direct =
        refs.testset?.id ??
        refs.testset?._id ??
        refs.testSet?.id ??
        refs.testSet?._id ??
        refs.set?.id ??
        refs.set?._id ??
        refs.testsetId ??
        refs.testset_id ??
        refs.testSetId ??
        refs.testSet_id ??
        refs.setId ??
        refs.set_id
    return direct ? String(direct) : undefined
}

const refsIndicateQuery = (refs: Record<string, any> | undefined | null): boolean => {
    if (!refs) return false
    return [
        refs.query,
        refs.query?.id,
        refs.queryId,
        refs.query_id,
        refs.queryRevision,
        refs.query_revision,
        refs.queryVariant,
        refs.query_variant,
    ].some((value) => (typeof value === "string" ? value.length > 0 : Boolean(value)))
}

const extractEvaluatorId = (refs: Record<string, any> | undefined | null): string | undefined => {
    if (!refs?.evaluator) return undefined
    // Prefer id, fall back to slug for matching
    return refs.evaluator.id ?? refs.evaluator.slug ?? undefined
}

export const deriveRunComparisonStructure = ({
    runIndex,
    steps,
}: {
    runIndex?: RunIndex | null
    steps?: Record<string, any>[] | null
}): RunComparisonStructure => {
    const testsetIds = new Set<string>()
    const evaluatorIds = new Set<string>()
    let hasQueryInput = false
    let inputStepCount = 0

    const inspectInputStep = (
        step: {references?: Record<string, any>; kind?: string} | null | undefined,
    ) => {
        if (!step) return
        const kind =
            step.kind ?? (step as any).type ?? (step as any).stepType ?? (step as any).step_role
        if (kind && kind !== "input") return
        inputStepCount += 1
        if (refsIndicateQuery(step.references)) {
            hasQueryInput = true
        }
        const testsetId = extractRefsTestsetId(step.references)
        if (testsetId) testsetIds.add(testsetId)
    }

    const inspectAnnotationStep = (
        step: {references?: Record<string, any>; kind?: string} | null | undefined,
    ) => {
        if (!step) return
        const evaluatorId = extractEvaluatorId(step.references)
        if (evaluatorId) evaluatorIds.add(evaluatorId)
    }

    const seenKeys = new Set<string>()

    if (runIndex) {
        Object.values(runIndex.steps ?? {}).forEach((meta) => {
            if (meta.kind === "input") {
                inputStepCount += 1
                if (refsIndicateQuery(meta.refs)) {
                    hasQueryInput = true
                }
                const testsetId = extractRefsTestsetId(meta.refs)
                if (testsetId) testsetIds.add(testsetId)
            } else if (meta.kind === "annotation") {
                const evaluatorId = extractEvaluatorId(meta.refs)
                if (evaluatorId) evaluatorIds.add(evaluatorId)
            }
            if (meta.key) {
                seenKeys.add(meta.key)
            }
        })
    }

    if (steps && steps.length) {
        steps.forEach((step: any) => {
            const key = typeof step?.key === "string" ? step.key : undefined
            if (key && seenKeys.has(key)) return
            inspectInputStep(step ?? undefined)
            inspectAnnotationStep(step ?? undefined)
            if (key) seenKeys.add(key)
        })
    }

    return {
        testsetIds: Array.from(testsetIds),
        hasQueryInput,
        inputStepCount,
        evaluatorIds: Array.from(evaluatorIds),
    }
}

/** Terminal statuses that allow comparison */
const TERMINAL_STATUSES = new Set(["success", "failure", "errors", "cancelled"])

/** Check if a status is terminal (run has finished) */
export const isTerminalStatus = (status: string | undefined | null): boolean => {
    if (!status) return false
    return TERMINAL_STATUSES.has(status.toLowerCase())
}

export interface CompareAvailabilityState {
    isLoading: boolean
    canCompare: boolean
    reason?: "loading" | "no-input" | "no-testset" | "query-input" | "pending-status"
    testsetIds: string[]
    evaluatorIds: string[]
    /** Current run status for display purposes */
    status?: string
}

export const compareAvailabilityAtomFamily = atomFamily((runId: string | null) =>
    atom<CompareAvailabilityState>((get) => {
        if (!runId) {
            return {
                isLoading: false,
                canCompare: false,
                reason: "no-input",
                testsetIds: [],
                evaluatorIds: [],
            }
        }

        const runQuery = get(evaluationRunQueryAtomFamily(runId))
        const isLoading = Boolean((runQuery as any)?.isLoading ?? (runQuery as any)?.isPending)
        const data: EvaluationRunQueryResult | undefined = runQuery.data

        if (!data) {
            return {
                isLoading: true,
                canCompare: false,
                reason: "loading",
                testsetIds: [],
                evaluatorIds: [],
            }
        }

        const structure = deriveRunComparisonStructure({
            runIndex: data.runIndex,
            steps: data.camelRun?.data?.steps ?? [],
        })

        // Get the run status from raw run data
        const runStatus = data.rawRun?.status ?? data.camelRun?.status

        let reason: CompareAvailabilityState["reason"] = undefined
        let canCompare = false

        // Check terminal status first - pending/running runs cannot be compared
        if (!isTerminalStatus(runStatus)) {
            reason = "pending-status"
        } else if (structure.inputStepCount === 0) {
            reason = "no-input"
        } else if (structure.testsetIds.length === 0) {
            reason = "no-testset"
        } else if (structure.hasQueryInput) {
            reason = "query-input"
        } else {
            canCompare = true
        }

        return {
            isLoading,
            canCompare,
            reason,
            testsetIds: structure.testsetIds,
            evaluatorIds: structure.evaluatorIds,
            status: runStatus,
        }
    }),
)

export const computeStructureFromRawRun = (run: any): RunComparisonStructure => {
    const index = buildRunIndex(run)
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    return deriveRunComparisonStructure({runIndex: index, steps})
}
