import {CamelCaseEnvironment} from "@/oss/lib/Types"

export type {OpenAPISpec} from "./openapi"

// Re-exports from former transformer/types (now colocated here)
export * from "./variantConfig"
export * from "./enhancedVariant"
export * from "./input"
export * from "./message"
export * from "./playground"
export * from "./testRun"

export interface Variant {
    id: string
    uri: string
    name: string
    version?: string
    createdAt?: string
    updatedAt?: string
    appId: string
    baseId: string
    baseName: string
    revision: string | number
    configName: string
    projectId: string
    appName: string
    templateVariantName: string
    variantName: string
    parameters?: Record<string, any> | null
    routePath?: string
    runtimePrefix: string
    modifiedBy: string
    modifiedById: string
    deployedIn?: CamelCaseEnvironment[]
    revisions: any[]
    prompts: any[]
    variantId: string

    createdAtTimestamp: number
    updatedAtTimestamp: number
    isLatestRevision: boolean
}
