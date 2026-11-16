import type {Visibility} from "@agenta/entities/sharing"
import type {CommitDeployOption} from "@agenta/entity-ui/modals"
import type {EnhancedModalProps as ModalProps} from "@agenta/ui"
import type {EnhancedButtonProps as ButtonProps} from "@agenta/ui/components/presentational"

/** Host side effects a commit triggers that this package has no business knowing about. */
export interface CommitHostAdapter {
    /**
     * The app the commit belongs to. Used for the post-commit navigation payload only.
     */
    appId?: string | null
    /**
     * The app's slug. "Commit and deploy" names the deployment after it. A host that has not
     * loaded the list of apps passes it, or the deployment cannot be named.
     */
    appSlug?: string | null
    /**
     * Refresh whatever list caches the host keeps outside the entities layer. Called after every
     * successful commit.
     */
    onAfterCommit?: () => void
    /** Analytics/onboarding hook. */
    onCommitted?: () => void
    /**
     * The visibility a create from an ephemeral entity asks for. Omitted: the server default
     * (private for an agent that has an owner). A host without sharing controls passes "project".
     */
    createVisibility?: Visibility
    /**
     * The environments "Commit and deploy" offers, by slug. Omitted: the three fixed ones. A host
     * whose project has other environments passes its own list.
     */
    commitDeployOptions?: CommitDeployOption[]
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
