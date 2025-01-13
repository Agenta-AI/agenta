import {Enhanced} from "@/components/PlaygroundTest/assets/utilities/genericTransformer/types"
import {InputType} from "@/components/PlaygroundTest/assets/utilities/transformer/types"

export type GenerationFocusDrawerHeaderProps = {
    format: string
    setFormat: React.Dispatch<React.SetStateAction<string>>
    className?: string
    variantId: string
    runRow: () => void
    isRunning: boolean | undefined
    loadNextRow: () => void
    loadPrevRow: () => void
    inputRows: Enhanced<InputType<string[]>>[]
    rowId: string
}
