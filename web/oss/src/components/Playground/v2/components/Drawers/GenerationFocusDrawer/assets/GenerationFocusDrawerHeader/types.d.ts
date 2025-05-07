import {Enhanced} from "@/oss/components/Playground/assets/utilities/genericTransformer/types"
import {InputType} from "@/oss/components/Playground/assets/utilities/transformer/types"

import {OutputFormat} from "../../types"

export interface GenerationFocusDrawerHeaderProps {
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
