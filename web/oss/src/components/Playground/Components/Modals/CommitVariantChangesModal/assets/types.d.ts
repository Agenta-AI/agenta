import type {EnhancedButtonProps as ButtonProps} from "@agenta/ui/components/presentational"
import type {EnhancedModalProps as ModalProps} from "@agenta/ui"

export interface CommitVariantChangesModalProps extends ModalProps {
    variantId: string
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}

export interface CommitVariantChangesButtonProps extends ButtonProps {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}
