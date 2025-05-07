import {ModalProps} from "antd"

export interface CommitVariantChangesModalProps extends ModalProps {
    variantId: string
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}

export interface SelectedCommitType {
    type: "version" | "variant" | null
    name?: string
}
