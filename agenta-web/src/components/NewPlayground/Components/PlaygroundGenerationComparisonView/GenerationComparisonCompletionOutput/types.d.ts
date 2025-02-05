import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {OutputFormat} from "../../Drawers/GenerationFocusDrawer/types"

export type GenerationComparisonCompletionOutputProps = {
    rowId: string
    focusDisable?: boolean
    variantId: string
    variantIndex?: number
    isLastRow?: boolean
    isLastVariant?: boolean
}
