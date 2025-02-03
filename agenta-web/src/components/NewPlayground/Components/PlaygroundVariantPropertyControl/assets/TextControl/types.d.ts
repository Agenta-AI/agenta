import type {BaseContainerProps} from "../../../types"

export interface TextControlProps extends BaseContainerProps {
    metadata: PropertyMetadata
    value: string
    as?: React.ElementType
    view?: string
    withTooltip?: boolean
    description?: string
    handleChange: (e: string | null) => void
}
