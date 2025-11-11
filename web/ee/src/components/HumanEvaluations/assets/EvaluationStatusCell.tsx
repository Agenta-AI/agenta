import {memo, useEffect, useMemo, useRef} from "react"

import {Tag, theme} from "antd"
import {useAtom, useAtomValue} from "jotai"
import {mutate} from "swr"

import {EvaluationType} from "@/oss/lib/enums"
import useEvaluationRunScenarios, {
    getEvaluationRunScenariosKey,
} from "@/oss/lib/hooks/useEvaluationRunScenarios"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {resourceStatusQueryFamily} from "@/oss/lib/hooks/usePreviewRunningEvaluations"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import {EvaluationStatus} from "@/oss/lib/Types"

import {statusMapper} from "../../pages/evaluations/cellRenderers/cellRenderers"

import {extractEvaluationStatus} from "./utils"

const EvaluationStatusCell = ({
    runId,
    status,
    evalType,
}: {
    runId: string
    status?: EvaluationStatus
    evalType?: "auto" | "human"
}) => {
    const swrData = useEvaluationRunScenarios(runId, undefined, {
        syncAtom: false,
        revalidateOnMount: true,
    })
    const {token} = theme.useToken()
    const {refetch} = useEvaluations({
        withPreview: true,
        types:
            evalType === "auto"
                ? [EvaluationType.automatic, EvaluationType.auto_exact_match]
                : [EvaluationType.human, EvaluationType.single_model_test],
        evalType,
    })
    const runningEvaluations = useAtomValue(
        resourceStatusQueryFamily(evalType === "auto" ? runId : ""),
    )
    const [tempEvaluation, setTempEvaluation] = useAtom(tempEvaluationAtom)
    const handledCompletionRef = useRef<Set<string>>(new Set())
    const lastMutatedStatusRef = useRef<{runId?: string; status?: EvaluationStatus | null} | null>(
        null,
    )

    // Force refetch once when component mounts (useful when returning from details page)
    useEffect(() => {
        if (!runId) return

        const key = getEvaluationRunScenariosKey(runId)
        if (!key) return

        const status = runningEvaluations.data?.run?.status ?? null
        const hasChanged =
            !lastMutatedStatusRef.current ||
            lastMutatedStatusRef.current.runId !== runId ||
            lastMutatedStatusRef.current.status !== status

        if (!hasChanged) return

        lastMutatedStatusRef.current = {runId, status}

        mutate(`${key}-false`)
    }, [runId, runningEvaluations.data?.run?.status])

    // refresh the eval after a completed run
    useEffect(() => {
        if (evalType !== "auto") return

        const runIdToCheck = runningEvaluations.data?.run?.id
        const runStatus = runningEvaluations.data?.run?.status

        if (!runIdToCheck || !runStatus) return

        const isTrackedTempEvaluation = tempEvaluation.some(
            (evaluation) => evaluation.id === runIdToCheck,
        )

        if (!isTrackedTempEvaluation) {
            handledCompletionRef.current.delete(runIdToCheck)
            return
        }

        const isTerminalStatus = ![
            EvaluationStatus.PENDING,
            EvaluationStatus.RUNNING,
            EvaluationStatus.CANCELLED,
            EvaluationStatus.INITIALIZED,
        ].includes(runStatus)

        if (!isTerminalStatus) {
            handledCompletionRef.current.delete(runIdToCheck)
            return
        }

        const hasHandledCompletion = handledCompletionRef.current.has(runIdToCheck)

        if (hasHandledCompletion) return

        handledCompletionRef.current.add(runIdToCheck)

        setTempEvaluation((prev) => prev.filter((evaluation) => evaluation.id !== runIdToCheck))
        refetch()
    }, [
        evalType,
        refetch,
        runningEvaluations.data?.run?.id,
        runningEvaluations.data?.run?.status,
        setTempEvaluation,
        tempEvaluation,
    ])

    const {runStatus, scenarios} = useMemo(() => {
        return extractEvaluationStatus(swrData.data?.scenarios || [], status, evalType)
    }, [status, token, swrData.data?.scenarios, evalType])

    const completedStatuses = [EvaluationStatus.SUCCESS]
    const {completedCount, totalCount} = useMemo(() => {
        return {
            completedCount: scenarios.filter((s) =>
                completedStatuses.includes(s.status as EvaluationStatus),
            ).length,
            totalCount: scenarios.length,
        }
    }, [scenarios])

    const _status = useMemo(() => {
        if (evalType !== "auto") return runStatus
        return runningEvaluations.data?.run?.status || runStatus
    }, [runningEvaluations.data?.run?.status, runStatus])

    return (
        <div className="w-full flex gap-4 items-center justify-between">
            <Tag color={statusMapper(token)(_status).color}>
                {statusMapper(token)(_status).label}
            </Tag>
            <div className="text-nowrap">{`${completedCount} / ${totalCount}`}</div>
        </div>
    )
}

export default memo(EvaluationStatusCell)
