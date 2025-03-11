import type {Enhanced} from "../../genericTransformer/types"

import type {InputType} from "./input"
import type {Message} from "./message"
import type {AgentaConfigPrompt, BaseVariant} from "./variant"

/** Enhanced Variant with embedded metadata */
export interface EnhancedVariant<
    T extends Enhanced<AgentaConfigPrompt> = Enhanced<AgentaConfigPrompt>,
> extends BaseVariant {
    isChat: boolean
    isChatVariant: boolean
    isCustom: boolean
    isStatelessVariant: boolean
    prompts: T[]
    inputs: Enhanced<InputType<string[]>[]>
    messages: Enhanced<Message[]>
    customProperties?: Record<string, Enhanced>
    __isMutating?: boolean
}
