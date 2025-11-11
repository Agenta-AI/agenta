import type {TestResult} from "@/oss/components/Playground/assets/utilities/transformer/types"

import {PromptMessageConfigProps} from "../../../PromptMessageConfig/types"

export interface GenerationChatRowProps {
    variantId?: string
    disabled?: boolean
    rowId?: string
    resultHash?: TestResult | string | null
    historyId?: string
    placeholder?: string
    withControls?: boolean
    messageId?: string
    viewAs?: "input" | "output"
    isRunning?: boolean
    message?: GenerationChatHistoryItem
    result?: TestResult
    isMessageDeletable?: boolean
    messageProps?: Partial<PromptMessageConfigProps>
    deleteMessage?: (messageId: string) => void
    rerunMessage?: (messageId: string) => void
}
