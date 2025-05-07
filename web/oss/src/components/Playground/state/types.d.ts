import {
    LightweightRevision,
    MessageWithRuns,
    WithRuns,
} from "@/oss/lib/hooks/useStatelessVariants/state/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import type {Enhanced, OpenAPISpec} from "../../../lib/shared/variant/genericTransformer/types"

export type EnhancedMessageWithRuns = Enhanced<MessageWithRuns>

// State Types
export interface InitialStateType {
    variants: EnhancedVariant[]
    appStatus: boolean
    selected: string[]
    spec?: OpenAPISpec
    fetching: boolean
    dirtyStates: Record<string, boolean>
    error?: Error
    uri?: {
        routePath: string
        runtimePrefix: string
    }
    availableRevisions?: LightweightRevision[]
    generationData: {
        inputs: Enhanced<WithRuns[]>
        messages: Enhanced<
            {
                history: MessageWithRuns[]
            }[]
        >
    }
}

export type GenerationInputRow = InitialStateType["generationData"]["inputs"]["value"][number]
export type GenerationChatRow = InitialStateType["generationData"]["messages"]["value"][number]
export type GenerationChatHistory = GenerationChatRow["history"]["value"]
export type GenerationChatHistoryItem = GenerationChatHistory[number]
