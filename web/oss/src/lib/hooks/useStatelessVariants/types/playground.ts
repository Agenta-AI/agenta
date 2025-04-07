import {type SWRHook} from "swr"

import {type FetcherOptions} from "@/oss/lib/api/types"
import {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"

export interface PlaygroundStateData {
    uri?: {
        runtimePrefix: string
        path: string
    }
    spec?: OpenAPISpec
    variants: any[]
    [key: string]: any
}

export interface PlaygroundSWRConfig<Data> {
    appId?: string
    projectId?: string
    initialVariants?: any[]
    cache?: Map<string, {data: Data}>
}

export interface PlaygroundMiddlewareParams<Data> {
    key: string | null
    fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null
    config: PlaygroundSWRConfig<Data>
}

export type PlaygroundMiddleware = (
    useSWRNext: SWRHook,
) => <Data extends PlaygroundStateData>(
    key: string | null,
    fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
    config?: PlaygroundSWRConfig<Data>,
) => ReturnType<SWRHook>
