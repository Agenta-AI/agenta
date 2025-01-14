import type {BaseContainerProps} from "../../../types"

export interface TextControlProps extends BaseContainerProps {
    metadata: PropertyMetadata
    value: string
    handleChange: (e: string | null) => void
    as?: React.ElementType
}
