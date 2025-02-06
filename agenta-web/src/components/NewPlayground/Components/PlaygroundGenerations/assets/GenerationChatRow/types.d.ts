import type {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import type {
    Message,
    TestResult,
} from "@/components/NewPlayground/assets/utilities/transformer/types"

export type GenerationChatRowProps = {
    variantId?: string
    disabled?: boolean
    rowId?: string
    historyId?: string
    placeholder?: string
    withControls?: boolean
    messageId?: string
    viewAs?: "input" | "output"
    isRunning?: boolean
    message?: Enhanced<Message>
    result?: TestResult
    isMessageDeletable?: boolean
    deleteMessage?: (messageId: string) => void
    rerunMessage?: (messageId: string) => void
}
