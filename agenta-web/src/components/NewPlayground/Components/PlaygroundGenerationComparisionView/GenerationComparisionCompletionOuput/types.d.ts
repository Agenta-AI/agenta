import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {OutputFormat} from "../../Drawers/GenerationFocusDrawer/types"

export type GenerationComparisionCompletionOuputProps = {
    variantId: string
    className?: string
    focusDisable?: boolean
    result?: Enhanced<InputType<string[]>> | undefined
    isRunning?: boolean | undefined
    format?: OutputFormat
    indexName?: string
}
