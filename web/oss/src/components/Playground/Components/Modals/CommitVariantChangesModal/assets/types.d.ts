import {ButtonProps} from "antd"
import {ModalProps} from "antd"

export interface CommitVariantChangesModalProps extends ModalProps {
    variantId: string
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}

export interface SelectedCommitType {
    type: "version" | "variant" | null
    name?: string
}

export interface CommitVariantChangesButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}

export interface CommitVariantChangesModalContentProps {
    variantId: string
    note: string
    setNote: React.Dispatch<React.SetStateAction<string>>
    selectedCommitType: SelectedCommitType | null
    setSelectedCommitType: React.Dispatch<React.SetStateAction<SelectedCommitType | null>>
    shouldDeploy: boolean
    onToggleDeploy: (value: boolean) => void
    selectedEnvironment: string | null
    onSelectEnvironment: (value: string | null) => void
    isDeploymentPending: boolean
}
