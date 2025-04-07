import type {CamelCaseEnvironment} from "@/oss/lib/Types"

export interface ApiVariant {
    variantId: string
    appId: string
    modifiedById: string
    uri?: string
    uriObject?: {
        runtimePrefix: string
        path: string
    }
}

export interface VariantRevision {
    id: string
    revision: number
    modifiedBy: string
    variantId: string
    config: {
        configName: string
        parameters: Record<string, any>
    }
    createdAt: string
    deployedIn: CamelCaseEnvironment | null
}

export interface Variant extends ApiVariant {
    modifiedBy: string
    deployedIn: CamelCaseEnvironment[]
    revisions: VariantRevision[]
    prompts: any[]
}
