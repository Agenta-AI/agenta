import {ModalProps} from "antd"

import {TooltipButtonProps} from "@/oss/components/Playground/assets/EnhancedButton"
import {EvaluationFlow, EvaluationScenario} from "@/oss/lib/Types"

export interface EvaluationRow extends EvaluationScenario, Record<string, string> {
    evaluationFlow: EvaluationFlow
}

export interface SaveDataModalProps extends ModalProps {
    rows: EvaluationRow[]
    exportDataset?: boolean
    name?: string
}

export interface SaveDataModalContentProps {
    rows: EvaluationRow[]
    rowKeys: string[]
    exportDataset?: boolean
    name: string
    setName: React.Dispatch<React.SetStateAction<string>>
    isOpen: boolean
    selectedColumns: string[]
    setSelectedColumns: React.Dispatch<React.SetStateAction<string[]>>
}

export interface SaveDataButtonProps extends TooltipButtonProps {
    rows: EvaluationRow[]
    exportDataset?: boolean
    name?: string
    icon?: boolean
    children?: React.ReactNode
    label?: string
}
