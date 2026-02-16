import {EnhancedModalProps} from "@/oss/components/EnhancedUIs/Modal/types"

export interface DeleteEvaluatorsModalProps extends Omit<EnhancedModalProps, "children" | "onOk"> {
    selectedCount: number
    selectedNames: string[]
    confirmLoading?: boolean
    onConfirm: () => void
}
