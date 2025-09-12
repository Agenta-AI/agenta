import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {getRequestSchema} from "@/oss/lib/shared/variant/openapiUtils"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

export interface RequestSchemaMetaParams {
    variant: EnhancedVariant
    routePath?: string
}

export interface RequestSchemaMeta {
    required: string[]
    inputKeys: string[]
    hasMessages: boolean
}

export const requestSchemaMetaAtomFamily = atomFamily((params: RequestSchemaMetaParams) =>
    atom<RequestSchemaMeta>(() => {
        const {variant, routePath} = params
        const spec = getSpecLazy()

        const meta: RequestSchemaMeta = {required: [], inputKeys: [], hasMessages: false}
        if (!spec) return meta

        const requestSchema: any = getRequestSchema(spec as any, {variant, routePath})
        if (!requestSchema || typeof requestSchema !== "object") return meta

        const properties = requestSchema.properties || {}
        const required = Array.isArray(requestSchema.required) ? requestSchema.required : []

        // inputKeys are all expected properties except reserved ones like ag_config and messages
        const inputKeys = Object.keys(properties).filter(
            (k) => !["ag_config", "messages"].includes(k),
        )

        const hasMessages = Boolean(properties?.messages)

        return {required, inputKeys, hasMessages}
    }),
)
