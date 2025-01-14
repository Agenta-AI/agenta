import type {BaseContainerProps} from "../types"

/** PlaygroundVariant component props */
export interface PlaygroundVariantProps extends BaseContainerProps {
    /** Unique identifier for the variant */
    variantId: string
    className?: string
}
