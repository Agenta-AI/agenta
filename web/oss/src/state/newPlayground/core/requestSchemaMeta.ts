import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {playgroundAppSchemaAtom} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"
import {getRequestSchema} from "@/oss/lib/shared/variant/openapiUtils"
import {constructPlaygroundTestUrl} from "@/oss/lib/shared/variant/stringUtils"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"

export interface RequestSchemaMetaParams {
    variant: EnhancedVariant
    routePath?: string
}

export interface RequestSchemaMeta {
    required: string[]
    inputKeys: string[]
    hasMessages: boolean
}

/**
 * Check x-agenta.flags.is_chat on the first available operation.
 * Returns true/false if the flag is present, or undefined if not found.
 */
function getIsChatFlag(spec: OpenAPISpec, routePath?: string): boolean | undefined {
    const endpoints = ["/run", "/test", "/generate", "/generate_deployed"] as const
    for (const endpoint of endpoints) {
        const path = constructPlaygroundTestUrl({routePath}, endpoint, false)
        const operation = spec?.paths?.[path]?.post as Record<string, unknown> | undefined
        const agentaExt = operation?.["x-agenta"] as Record<string, unknown> | undefined
        const flags = agentaExt?.flags as Record<string, unknown> | undefined
        if (flags && typeof flags.is_chat === "boolean") {
            return flags.is_chat
        }
    }
    return undefined
}

export const requestSchemaMetaAtomFamily = atomFamily((params: RequestSchemaMetaParams) =>
    atom<RequestSchemaMeta>((get) => {
        const {variant, routePath} = params
        const spec = get(playgroundAppSchemaAtom)

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

        // Prefer explicit x-agenta.flags.is_chat, fall back to messages property heuristic
        const flagValue = getIsChatFlag(spec as OpenAPISpec, routePath)
        const hasMessages = flagValue ?? Boolean(properties?.messages)

        return {required, inputKeys, hasMessages}
    }),
)
