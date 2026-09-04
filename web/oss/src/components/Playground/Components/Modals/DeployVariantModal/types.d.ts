import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import type {EnhancedModalProps as ModalProps} from "@agenta/ui"

export interface ExtendedEnvironment extends AppEnvironmentDeployment {
    revision?:
        | {
              id: string
              revisionNumber: number
              name: string
          }
        | string
        | null
}
export interface DeployVariantModalProps extends ModalProps {
    /** When deploying a whole variant (not a specific revision). Synonym: variantId. */
    parentVariantId?: string | null
    /** Optional alias supported by DeployVariantButton */
    variantId?: string
    revisionId?: string | null
    environments?: ExtendedEnvironment[]
    variantName?: string
    revision?: number | string
    isLoading?: boolean
    mutate?: () => void | Promise<void>
}
