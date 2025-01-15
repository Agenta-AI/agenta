import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {Message} from "@/components/NewPlayground/assets/utilities/transformer/types"

export type GenerationChatRowProps = {
    variantId: string
    message: Enhanced<Message>
    disabled?: boolean
    type: "input" | "output"
}
