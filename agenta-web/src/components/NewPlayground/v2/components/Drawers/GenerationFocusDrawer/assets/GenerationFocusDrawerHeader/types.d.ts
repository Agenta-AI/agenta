import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {InputType} from "@/components/NewPlayground/assets/utilities/transformer/types"
import {OutputFormat} from "../../types"

export type GenerationFocusDrawerHeaderProps = {
    format: OutputFormat
    setFormat: React.Dispatch<React.SetStateAction<OutputFormat>>
    className?: string
    variantId: string
    runRow: () => void
    isRunning: boolean | undefined
    loadNextRow: () => void
    loadPrevRow: () => void
    inputRows: Enhanced<InputType<string[]>>[]
    rowId: string
}
