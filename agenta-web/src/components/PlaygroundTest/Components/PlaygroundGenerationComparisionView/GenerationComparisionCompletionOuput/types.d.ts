import {Enhanced} from "@/components/PlaygroundTest/assets/utilities/genericTransformer/types"

export type GenerationComparisionCompletionOuputProps = {
    variantId: string
    className?: string
    focusDisable?: boolean
    result?: Enhanced<InputType<string[]>> | undefined
    isRunning?: boolean | undefined
}
