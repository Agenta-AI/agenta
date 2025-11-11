import {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import {ColumnsType} from "antd/es/table"

export interface AutoEvaluationHeaderProps {
    selectedRowKeys: React.Key[]
    evaluations: EvaluationRow[]
    columns: ColumnsType<EvaluationRow>
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
    setHiddenColumns: React.Dispatch<React.SetStateAction<string[]>>
    selectedEvalRecord: EvaluationRow
    fetchEvaluations: () => void
    setIsDeleteEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    viewType?: "overview" | "evaluation"
}
