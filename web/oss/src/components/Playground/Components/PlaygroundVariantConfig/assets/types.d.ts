import type {ReactNode} from "react"

import {BaseContainerProps} from "../../types"

export interface PlaygroundVariantConfigHeaderProps extends BaseContainerProps {
    variantId: string
    embedded?: boolean
    variantNameOverride?: string
    revisionOverride?: number | string | null
    /** Evaluator type label (e.g. "Regex Test") */
    evaluatorLabel?: string
    /** Whether to show Load Preset button */
    hasPresets?: boolean
    /** Callback when Load Preset is clicked */
    onLoadPreset?: () => void
    /** Extra actions to render in the right side of the toolbar */
    extraActions?: ReactNode
}
