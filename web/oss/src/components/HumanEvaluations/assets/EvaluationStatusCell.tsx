import {memo, useEffect, useMemo} from "react"

import {Tag, theme} from "antd"
import {mutate} from "swr"

import useEvaluationRunScenarios, {
    getEvaluationRunScenariosKey,
} from "@/oss/lib/hooks/useEvaluationRunScenarios"
import {EvaluationStatus} from "@/oss/lib/Types"

import {statusMapper} from "../../pages/evaluations/cellRenderers/cellRenderers"

import {extractEvaluationStatus} from "./utils"

const EvaluationStatusCell = ({runId, status}: {runId: string; status?: EvaluationStatus}) => {
    const swrData = useEvaluationRunScenarios(runId, undefined, {
        syncAtom: false,
    })
    const {token} = theme.useToken()

    // Force refetch once when component mounts (useful when returning from details page)
    useEffect(() => {
        const key = `${getEvaluationRunScenariosKey(runId)}-false`
        mutate(key)
    }, [runId])

    const {runStatus, scenarios} = useMemo(() => {
        return extractEvaluationStatus(swrData.data?.scenarios || [], status)
    }, [status, token, swrData.data?.scenarios])

    const completedStatuses = [EvaluationStatus.SUCCESS]
    const {completedCount, totalCount} = useMemo(() => {
        return {
            completedCount: scenarios.filter((s) =>
                completedStatuses.includes(s.status as EvaluationStatus),
            ).length,
            totalCount: scenarios.length,
        }
    }, [scenarios])

    return (
        <div className="flex gap-4 items-center justify-between">
            <Tag color={statusMapper(token)(runStatus).color}>
                {statusMapper(token)(runStatus).label}
            </Tag>
            <div className="text-nowrap">{`${completedCount} / ${totalCount}`}</div>
        </div>
    )
}

export default memo(EvaluationStatusCell)
