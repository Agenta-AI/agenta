import {HTMLAttributes} from "react"
import {StateVariant} from "../state/types"

/**
 * Base interface for components that render as HTML containers
 * @template T - HTML element type, defaults to HTMLDivElement
 */
export interface BaseContainerProps<T = HTMLDivElement> extends HTMLAttributes<T> {
    /** Additional className to be merged with default styles */
    className?: string
}

/** Props for components that need variant ID */
export interface VariantIdProps {
    /** Unique identifier for the variant */
    variantId: StateVariant["variantId"]
}
