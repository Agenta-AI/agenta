import type {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import type {
    Message,
    TestResult,
} from "@/components/NewPlayground/assets/utilities/transformer/types"

export type GenerationChatRowProps = {
    variantId?: string
    disabled?: boolean
    rowId?: string
    withControls?: boolean
    messageId?: string
    viewAs?: "input" | "output"
    deleteMessage: (messageId: string) => void
    isRunning?: boolean
    message: Enhanced<Message>
    result?: TestResult
    isMessageDeletable?: boolean
}
