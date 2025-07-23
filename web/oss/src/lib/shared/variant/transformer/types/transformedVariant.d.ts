import {CamelCaseEnvironment, VariantRevision} from "@/oss/lib/Types"

import type {Enhanced} from "../../genericTransformer/types"

import type {AgentaConfigPrompt, BaseVariant} from "./variant"

/** Enhanced Variant with embedded metadata */
export interface EnhancedVariant<
    T extends Enhanced<AgentaConfigPrompt> = Enhanced<AgentaConfigPrompt>,
> extends BaseVariant {
    isChat: boolean
    isChatVariant: boolean
    inputParams?: Record<string, any>[]
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
    _parentVariant: {
        name: string
        id: string
        variantName: string
        variantId: string
        baseId: string
        baseName: string
        configName: string
        parameters: Record<string, any>
        createdAt: string
        updatedAt: string
        createdBy: User
        templateVariantName: string
        revision: number
    }
}
