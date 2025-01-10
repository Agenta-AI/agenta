import {BaseContainerProps} from "../types"

/** Props for the playground variants container component */
export interface PlaygroundVariantsContainerProps extends BaseContainerProps {
    /** Flag indicating if the container should be shown */
    show?: boolean
}

/** Props for the variant list component */
export interface VariantListProps extends BaseContainerProps {
    /** Array of variant IDs to render */
    variantIds: string[]
}

/** Props for a single variant item component */
export interface VariantItemProps extends BaseContainerProps {
    /** Unique identifier for the variant */
    variantId: string
}
