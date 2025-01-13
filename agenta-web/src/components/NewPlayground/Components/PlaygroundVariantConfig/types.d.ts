import {BaseContainerProps} from "../types"
import {MouseEvent} from "react"

export interface VariantConfigComponentProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: string
}

/** Props for variant action buttons */
export interface VariantActionButtonProps {
    /** ID of the variant the action applies to */
    variantId: string
}

/** Props for the variants container */
export interface PlaygroundVariantsContainerProps extends BaseContainerProps {
    /** Array of variant IDs to display */
    variantIds: string[]
}
