import type {
    Common,
    Enhanced,
    Merge,
    OpenAPISpec,
} from "../assets/utilities/genericTransformer/types"
import type {EnhancedVariant, Message, TestResult} from "../assets/utilities/transformer/types"

export type MessageWithId = Merge<Common, Message>

interface WithRuns {
    __runs?: Record<
        string,
        | {
              __isRunning?: boolean
              __result?: TestResult | string | null
              __id?: string
              message?: Enhanced<MessageWithId>
          }
        | undefined
    >
    message?: MessageWithId
    __result?: TestResult | string | null
    __isRunning?: boolean
}

export type MessageWithRuns = Merge<WithRuns, MessageWithId>
export type EnhancedMessageWithRuns = Enhanced<MessageWithRuns>

// State Types
export interface InitialStateType {
    variants: EnhancedVariant[]
    selected: string[]
    spec?: OpenAPISpec
    dirtyStates: Record<string, boolean>
    error?: Error
    uri?: string
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
