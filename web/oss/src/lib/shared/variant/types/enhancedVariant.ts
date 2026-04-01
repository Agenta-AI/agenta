import type {Enhanced} from "@agenta/entities/legacyAppRevision"

import {CamelCaseEnvironment, VariantRevision} from "@/oss/lib/Types"

import type {AgentaConfigPrompt, BaseVariant} from "./variantConfig"

/** Enhanced Variant with embedded metadata */
export interface EnhancedVariant<
    T extends Enhanced<AgentaConfigPrompt> = Enhanced<AgentaConfigPrompt>,
> extends BaseVariant {
    appStatus?: boolean
    isCustom: boolean
    prompts: T[]
    customProperties?: Record<string, Enhanced>
    isLatestRevision: boolean
    deployedIn: CamelCaseEnvironment[]
    variantId: string
    modifiedById: string
    createdBy: string
    modifiedBy: string
    __isMutating?: boolean
    revisions?: VariantRevision[]
    uriObject?: {
        routePath?: string
        runtimePrefix: string
    }
    _parentVariant?: string
}
