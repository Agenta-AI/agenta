import type {EnhancedModalProps as ModalProps} from "@agenta/ui"
import type {EnhancedButtonProps as ButtonProps} from "@agenta/ui/components/presentational"

/** Host side effects a commit triggers that this package has no business knowing about. */
export interface CommitHostAdapter {
    /**
     * The app the commit belongs to. The desktop reads its selected app; a surface scoped to one
     * agent already knows it. Used for the post-commit navigation payload only.
     */
    appId?: string | null
    /**
     * Refresh whatever list caches the host keeps outside the entities layer (the desktop's
     * variant registry and evaluator tables). Called after every successful commit.
     */
    onAfterCommit?: () => void
    /** Analytics/onboarding hook — the desktop records a widget event here. */
    onCommitted?: () => void
}

export interface CommitVariantChangesModalProps extends ModalProps, CommitHostAdapter {
    variantId: string
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}

export interface CommitVariantChangesButtonProps extends ButtonProps, CommitHostAdapter {
    variantId: string
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
    onSuccess?: (props: {revisionId?: string; variantId?: string}) => void
}
