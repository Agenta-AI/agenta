import type {EnhancedModalProps} from "@agenta/ui/components/modal"

export interface DeleteEvaluatorsModalProps extends Omit<EnhancedModalProps, "children" | "onOk"> {
    selectedCount: number
    revisionIds: string[]
    confirmLoading?: boolean
    onConfirm: () => void
}
