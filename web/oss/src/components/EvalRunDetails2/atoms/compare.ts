import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {buildRunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

import {evaluationRunQueryAtomFamily} from "./table/run"
import type {EvaluationRunQueryResult} from "./table/run"
import type {RunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

export const MAX_COMPARISON_RUNS = 4

export const COMPARISON_COLORS = ["transparent", "#F3F8FF", "#FDF4F4", "#F6F0FF", "#F1FAF0"]

export const getComparisonColor = (index: number) =>
    COMPARISON_COLORS[index] ?? COMPARISON_COLORS[0]

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

export const deriveRunComparisonStructure = ({
    runIndex,
    steps,
}: {
    runIndex?: RunIndex | null
    steps?: Array<Record<string, any>> | null
}): RunComparisonStructure => {
    const testsetIds = new Set<string>()
    let hasQueryInput = false
    let inputStepCount = 0

    const inspectStep = (
        step: {references?: Record<string, any>; kind?: string} | null | undefined,
    ) => {
        if (!step) return
        const kind = step.kind ?? step.type ?? step.stepType ?? step.step_role
        if (kind && kind !== "input") return
        inputStepCount += 1
        if (refsIndicateQuery(step.references)) {
            hasQueryInput = true
        }
        const testsetId = extractRefsTestsetId(step.references)
        if (testsetId) testsetIds.add(testsetId)
    }

    const seenKeys = new Set<string>()

    if (runIndex) {
        Object.values(runIndex.steps ?? {}).forEach((meta) => {
            if (meta.kind !== "input") return
            inputStepCount += 1
            if (refsIndicateQuery(meta.refs)) {
                hasQueryInput = true
            }
            const testsetId = extractRefsTestsetId(meta.refs)
            if (testsetId) testsetIds.add(testsetId)
            if (meta.key) {
                seenKeys.add(meta.key)
            }
        })
    }

    if (steps && steps.length) {
        steps.forEach((step: any) => {
            const key = typeof step?.key === "string" ? step.key : undefined
            if (key && seenKeys.has(key)) return
            inspectStep(step ?? undefined)
            if (key) seenKeys.add(key)
        })
    }

    return {
        testsetIds: Array.from(testsetIds),
        hasQueryInput,
        inputStepCount,
    }
}

export interface CompareAvailabilityState {
    isLoading: boolean
    canCompare: boolean
    reason?: "loading" | "no-input" | "no-testset" | "query-input"
    testsetIds: string[]
}

export const compareAvailabilityAtomFamily = atomFamily((runId: string | null) =>
    atom<CompareAvailabilityState>((get) => {
        if (!runId) {
            return {
                isLoading: false,
                canCompare: false,
                reason: "no-input",
                testsetIds: [],
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
            }
        }

        const structure = deriveRunComparisonStructure({
            runIndex: data.runIndex,
            steps: data.camelRun?.data?.steps ?? [],
        })

        let reason: CompareAvailabilityState["reason"] = undefined
        let canCompare = false
        if (structure.inputStepCount === 0) {
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
        }
    }),
)

export const computeStructureFromRawRun = (run: any): RunComparisonStructure => {
    const index = buildRunIndex(run)
    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
    return deriveRunComparisonStructure({runIndex: index, steps})
}
