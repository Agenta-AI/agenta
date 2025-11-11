import {memo, useEffect, useMemo} from "react"

import {Tag, theme} from "antd"
import {mutate} from "swr"

import useEvaluationRunScenarios, {
    getEvaluationRunScenariosKey,
} from "@/oss/lib/hooks/useEvaluationRunScenarios"
import {EvaluationStatus} from "@/oss/lib/Types"

import {statusMapper} from "../../pages/evaluations/cellRenderers/cellRenderers"

import {extractEvaluationStatus} from "./utils"
import {useAtom, useAtomValue} from "jotai"
import {resourceStatusQueryFamily} from "@/oss/lib/hooks/usePreviewRunningEvaluations"
import {tempEvaluationAtom} from "@/oss/lib/hooks/usePreviewRunningEvaluations/states/runningEvalAtom"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import {EvaluationType} from "@/oss/lib/enums"

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

    // Force refetch once when component mounts (useful when returning from details page)
    useEffect(() => {
        const key = `${getEvaluationRunScenariosKey(runId)}-false`
        mutate(key)
    }, [runId, runningEvaluations.data?.run?.status])

    // refresh the eval after a completed run
    useEffect(() => {
        if (evalType !== "auto") return

        const findTempEvaluation = tempEvaluation.findIndex(
            (e) => e.id === runningEvaluations.data?.run?.id,
        )

        // console.log("TEMP findTempEvaluation", findTempEvaluation)
        // console.log("TEMP runningEvaluations", runningEvaluations.data?.run)
        if (
            findTempEvaluation !== -1 &&
            ![
                EvaluationStatus.PENDING,
                EvaluationStatus.RUNNING,
                EvaluationStatus.CANCELLED,
                EvaluationStatus.INITIALIZED,
            ].includes(runningEvaluations.data?.run?.status)
        ) {
            // console.log("TEMP inside the condition")
            setTempEvaluation((prev) =>
                prev.filter((e) => e.id !== runningEvaluations.data?.run?.id),
            )
            refetch()
            // console.log("TEMP after the setTempEvaluation")
            // runningEvaluations.data?.run?.status = tempEvaluation[findTempEvaluation].status
        }
    }, [tempEvaluation, runningEvaluations, evalType])

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
