import {BaseContainerProps} from "../types"

export interface PlaygroundVariantCustomPropertiesProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: string
    initialOpen?: boolean
}
