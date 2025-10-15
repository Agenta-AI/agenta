import {GenerationChatRow, GenerationInputRow} from "@/oss/components/Playground/state/types"
import {ConfigMetadata, OpenAPISpec} from "@/oss/lib/shared/variant/genericTransformer/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

export type InvokedVariant = {
    variant: EnhancedVariant
    allMetadata: Record<string, ConfigMetadata>
    inputRow: GenerationInputRow
    messageRow?: GenerationChatRow
    rowId: string
    appId: string
    uri: {
        runtimePrefix: string
        routePath?: string
        status?: boolean
    }
    headers: Record<string, string>
    projectId: string
    messageId?: string
    chatHistory?: any[]
    spec: OpenAPISpec
    runId: string
}

export enum Role {
    SYSTEM = "system",
    USER = "user",
    ASSISTANT = "assistant",
    TOOL = "tool",
    FUNCTION = "function",
}
export type RunAutoEvalFixtureType = {
    evaluators: string[]
    testset?: string
    variants: string[]
}

export interface EvaluationFixtures extends BaseFixture {
    navigateToEvaluation: (appId: string) => Promise<void>
    runAutoEvaluation: (config: RunAutoEvalFixtureType) => Promise<void>
}
