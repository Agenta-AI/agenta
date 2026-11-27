import type {EnhancedModalProps} from "@/oss/components/LegacyKit"

export interface DeleteEvaluatorsModalProps extends Omit<EnhancedModalProps, "children" | "onOk"> {
    selectedCount: number
    revisionIds: string[]
    confirmLoading?: boolean
    onConfirm: () => void
}
