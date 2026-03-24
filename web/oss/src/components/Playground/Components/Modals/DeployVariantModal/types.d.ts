import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {ModalProps} from "antd"

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
    parentVariantId?: string
    /** Optional alias supported by DeployVariantButton */
    variantId?: string
    revisionId?: string
    environments?: ExtendedEnvironment[]
    variantName: string
    revision: number | string
    isLoading?: boolean
    mutate: () => Promise<void>
}
