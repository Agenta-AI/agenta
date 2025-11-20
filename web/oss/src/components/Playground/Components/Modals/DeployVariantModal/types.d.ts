import {ModalProps} from "antd"

import {Environment} from "@/oss/lib/Types"

export interface ExtendedEnvironment extends Environment {
    revision?: {
        id: string
        revisionNumber: number
        name: string
    }
}
export interface DeployVariantModalProps extends ModalProps {
    variantId?: string
    revisionId?: string
    environments: ExtendedEnvironment[]
    variantName: string
    revision: number | string
    isLoading?: boolean
    mutate: () => Promise<void>
}
