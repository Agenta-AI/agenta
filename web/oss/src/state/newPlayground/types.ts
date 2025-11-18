/**
 * New Playground State Architecture
 *
 * This architecture separates concerns and eliminates sync overhead:
 * 1. Config management (mutable, independent from revisions)
 * 2. Generation data (test inputs, messages, results)
 * 3. Derived state (request bodies, validation)
 */

export interface PlaygroundVariantConfig {
    id: string
    name: string
    isChatVariant: boolean
    prompts: Record<string, any>
    parameters: Record<string, any>
    metadata: {
        createdAt: number
        updatedAt: number
        originalRevisionId?: string
    }
}

export interface PlaygroundConfig {
    variants: Record<string, PlaygroundVariantConfig>
    selectedVariantId: string
    displayedVariantIds: string[]
}

export interface TestInput {
    __id: string
    __metadata: Record<string, any>
    __runs: Record<string, TestRun>
    [variableName: string]: any
}

export interface ChatMessage {
    __id: string
    __metadata: Record<string, any>
    __runs: Record<string, TestRun>
    history: {
        value: ChatHistoryItem[]
        __metadata: Record<string, any>
    }
    [variableName: string]: any
}

export interface ChatHistoryItem {
    __id: string
    role: "user" | "assistant" | "system"
    content: any
    __runs?: Record<string, TestRun>
    __metadata?: Record<string, any>
}

export interface TestRun {
    __isRunning?: string | boolean
    __result?: any
    __error?: any
    __timestamp?: number
}

export interface GenerationData {
    inputs: TestInput[]
    messages: ChatMessage[]
    metadata: {
        lastUpdated: number
        totalRuns: number
    }
}

export interface PlaygroundState {
    config: PlaygroundConfig
    generation: GenerationData
}

// Mutation parameter types
export interface UpdateConfigParams {
    variantId: string
    path: string[]
    value: any
}

export interface AddTestCaseParams {
    mode: "completion" | "chat"
    variables?: Record<string, string>
}

export interface RunTestParams {
    rowId: string
    variantId: string
}

export interface DeleteMessageParams {
    rowId: string
    messageId: string
    variantId?: string
}

// Derived state types
export interface DerivedRequestBody {
    variantId: string
    requestBody: any
    isValid: boolean
    validationErrors: string[]
}

export interface DirtyState {
    variantId: string
    isDirty: boolean
    changes: string[]
}
