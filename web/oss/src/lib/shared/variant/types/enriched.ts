import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"
import {type Variant} from "@/oss/lib/Types"

export interface SharedEnrichmentOptions {
    appId: string
    projectId: string
    initialVariants?: Variant[]
    initialSpec?: OpenAPISpec
    logger?: typeof console.log
}

export interface SharedEnrichmentResult<Data extends PlaygroundStateData = PlaygroundStateData> {
    variants: Variant[]
    spec?: OpenAPISpec
    uri?: {
        routePath: string
        runtimePrefix: string
        status?: boolean
    }
    state: Data
    error?: Error
}
