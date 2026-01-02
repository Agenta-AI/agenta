import type {QueryKey} from "@tanstack/react-query"
import type {ModalProps} from "antd"

export type DeleteEvaluationKind = "auto" | "human" | "online" | "custom"

export interface DeleteEvaluationModalDeletionConfig {
    evaluationKind: DeleteEvaluationKind
    projectId?: string | null
    previewRunIds?: string[]
    invalidateQueryKeys?: QueryKey[]
    onSuccess?: () => void | Promise<void>
    onError?: (error: unknown) => void
}

export interface DeleteEvaluationModalProps extends ModalProps {
    evaluationType: string
    isMultiple?: boolean
    deletionConfig?: DeleteEvaluationModalDeletionConfig
}
