import {BaseContainerProps} from "../../types"

export interface PlaygroundVariantConfigHeaderProps extends BaseContainerProps {
    variantId: string
    embedded?: boolean
    variantNameOverride?: string
    revisionOverride?: number | string | null
}
