import {CamelCaseEnvironment} from "@/oss/lib/Types"

export type {OpenAPISpec} from "./openapi"

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
    uriObject?: {
        routePath?: string
        runtimePrefix: string
    }
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
