import type {Enhanced} from "@/oss/lib/shared/variant/genericTransformer/types"

import {BaseContainerProps} from "../types"

export interface PlaygroundVariantCustomPropertiesProps extends BaseContainerProps {
    /** ID of the variant being configured */
    variantId: string
    initialOpen?: boolean
    /** When true, renders controls in read-only (disabled) mode */
    viewOnly?: boolean
    /** Optional override to provide a stable custom properties record */
    customPropsRecord?: Record<string, Enhanced<any>>
}
