import {BaseContainerProps} from "../../../types"

export interface GenerationCompletionRowProps extends BaseContainerProps {
    variantId?: string
    rowId: string
    inputOnly?: boolean
    view?: string
}
