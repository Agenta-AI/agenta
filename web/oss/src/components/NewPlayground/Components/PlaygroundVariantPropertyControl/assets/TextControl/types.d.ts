import {SharedEditorProps} from "../../../SharedEditor/types"

export interface TextControlProps extends Omit<SharedEditorProps, "initialValue"> {
    metadata: PropertyMetadata
    value: string
    as?: React.ElementType
    view?: string
    withTooltip?: boolean
    description?: string
    handleChange?: (e: string | null) => void
}
