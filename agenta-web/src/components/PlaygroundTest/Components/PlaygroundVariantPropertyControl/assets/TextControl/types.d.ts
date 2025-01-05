import type {BaseContainerProps} from "../../../types"

export interface TextControlProps extends BaseContainerProps {
    metadata: PropertyMetadata
    value: string
    handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    as?: React.ElementType
}
