import {Key} from "react"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import {SingleModelEvaluationListTableDataType} from "@/oss/lib/Types"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

export type EvaluationRow =
    | SingleModelEvaluationListTableDataType
    | EnrichedEvaluationRun
    | {key: string; [k: string]: any}

export interface SingleModelEvaluationHeaderProps {
    viewType: "evaluation" | "overview"
    selectedRowKeys: Key[]
    mergedEvaluations: EvaluationRow[]
    runMetricsMap: Record<string, Record<string, BasicStats>> | undefined
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<Key[]>>
    isDeleteEvalModalOpen: boolean
    setIsDeleteEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    selectedEvalRecord?: EvaluationRow
    setSelectedEvalRecord: React.Dispatch<React.SetStateAction<EvaluationRow | undefined>>
}
