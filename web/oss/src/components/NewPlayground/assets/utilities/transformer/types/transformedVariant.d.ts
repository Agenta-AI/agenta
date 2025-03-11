import type {Enhanced} from "../../genericTransformer/types"

import type {AgentaConfigPrompt, BaseVariant} from "./variant"

/** Enhanced Variant with embedded metadata */
export interface EnhancedVariant<
    T extends Enhanced<AgentaConfigPrompt> = Enhanced<AgentaConfigPrompt>,
> extends BaseVariant {
    isChat: boolean
    isCustom: boolean
    prompts: T[]
    customProperties?: Record<string, Enhanced>
    __isMutating?: boolean
}
