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
export type RoleType = "system" | "user" | "assistant" | "tool" | "function"

export interface VariantFixtures extends BaseFixture {
    navigateToPlayground: (appId: string) => Promise<void>
    runCompletionSingleViewVariant: (appId: string, messages: string[]) => Promise<void>
    runChatSingleViewVariant: (appId: string, messages: string[]) => Promise<void>
    addNewPrompt: (promptMessages: {prompt: string; role: RoleType}[]) => Promise<void>
    changeVariableKeys: (variables: {oldKey: string; newKey: string}[]) => Promise<void>
    saveVariant: (
        type: "version" | "variant",
        note?: string,
        revisionId?: string,
        variantName?: string,
    ) => Promise<void>
}
