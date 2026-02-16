import {memo, useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/store"
import {
    hasScenarioStepData,
    useScenarioStepSnapshot,
} from "@/oss/lib/hooks/useEvaluationRunData/useScenarioStepSnapshot"

import {CellWrapper} from "./CellComponents"

const TimestampCell = ({
    scenarioId,
    runId: propRunId,
    timestamp: providedTimestamp,
    isGroupStart = true,
}: {
    scenarioId: string
    runId?: string
    timestamp?: string | null
    isGroupStart?: boolean
}) => {
    const store = evalAtomStore()
    const contextRunId = useRunId()
    const effectiveRunId = useMemo(
        () => propRunId ?? contextRunId ?? null,
        [propRunId, contextRunId],
    )

    const stepSnapshot = useScenarioStepSnapshot(scenarioId, effectiveRunId)

    const runStateAtom = useMemo(
        () => (effectiveRunId ? evaluationRunStateFamily(effectiveRunId) : atom(() => undefined)),
        [effectiveRunId],
    )
    const runState = useAtomValue(runStateAtom, {store}) as any

    let timestamp: string | undefined | null = providedTimestamp ?? undefined
    if (!timestamp && hasScenarioStepData(stepSnapshot.data)) {
        const invocation = stepSnapshot.data?.invocationSteps?.[0]
        const fallback = invocation ?? stepSnapshot.data?.inputSteps?.[0]
        timestamp =
            (invocation?.timestamp as string | undefined) ||
            (invocation?.createdAt as string | undefined) ||
            (fallback?.timestamp as string | undefined) ||
            (fallback?.createdAt as string | undefined)
    }

    if (!timestamp && runState) {
        const scenario =
            Array.isArray(runState?.scenarios) &&
            runState.scenarios.find((sc: any) => sc.id === scenarioId || sc._id === scenarioId)
        timestamp =
            (scenario?.timestamp as string | undefined) ||
            (scenario?.createdAt as string | undefined) ||
            timestamp
        if (!timestamp) {
            const timeMeta = runState?.statusMeta?.timestamps?.[scenarioId]
            const transitionMeta = runState?.statusMeta?.transitions?.[scenarioId]
            const candidate =
                (timeMeta?.startedAt as any) ??
                (timeMeta?.endedAt as any) ??
                (Array.isArray(transitionMeta) && transitionMeta[0]?.timestamp)
            if (candidate != null) {
                timestamp = String(candidate)
            }
        }
    }

    const normalizeToDayjs = (value: string | number | undefined) => {
        if (value == null) return null
        if (typeof value === "string") {
            const parsed = dayjs(value)
            if (parsed.isValid()) return parsed
            const numeric = Number(value)
            if (!Number.isNaN(numeric)) {
                const ms = numeric > 1e12 ? numeric : numeric * 1000
                const parsedNumeric = dayjs(ms)
                return parsedNumeric.isValid() ? parsedNumeric : null
            }
            return null
        }
        if (typeof value === "number") {
            const ms = value > 1e12 ? value : value * 1000
            const parsed = dayjs(ms)
            return parsed.isValid() ? parsed : null
        }
        return null
    }

    const parsedTimestamp = normalizeToDayjs(timestamp || undefined)
    const formatted = parsedTimestamp?.isValid()
        ? parsedTimestamp.format("MMM D, YYYY HH:mm:ss")
        : undefined

    if (
        !formatted &&
        process.env.NODE_ENV !== "production" &&
        typeof window !== "undefined" &&
        effectiveRunId
    ) {
        console.debug("[OnlineEval][TimestampCell] Missing timestamp", {
            runId: effectiveRunId,
            scenarioId,
            raw: timestamp,
            stepState: stepSnapshot.state,
        })
    }

    return (
        <CellWrapper className="text-gray-600">
            {formatted ? (
                <span className={isGroupStart ? "font-medium" : "text-gray-400"}>{formatted}</span>
            ) : (
                <span className="text-gray-400">—</span>
            )}
        </CellWrapper>
    )
}

export default memo(TimestampCell)
