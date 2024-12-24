import {BaseContainerProps} from "../types"
import {MouseEvent} from "react"

/** Props for the variant configuration header */
export interface VariantHeaderProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: string
}

/** Props for variant action buttons */
export interface VariantActionButtonProps {
    /** ID of the variant the action applies to */
    variantId: string
}

/** Props for the main variant configuration component */
export interface PlaygroundVariantConfigProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: string
}

/** Props for the variants container */
export interface PlaygroundVariantsContainerProps extends BaseContainerProps {
    /** Array of variant IDs to display */
    variantIds: string[]
}

/** Props for individual variant wrapper */
export interface VariantWrapperProps extends BaseContainerProps {
    /** ID of the variant */
    variantId: string
}
