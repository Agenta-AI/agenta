import {GenerationChatRow, GenerationInputRow} from "@/oss/components/Playground/state/types"
import {ConfigMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {constructPlaygroundTestUrl} from "@/oss/lib/shared/variant/stringUtils"
import {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"
import {stripAgentaMetadataDeep} from "@/oss/lib/shared/variant/valueHelpers"

import {transformToRequestBody} from "../../../../../lib/shared/variant/transformer/transformToRequestBody"
import {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import {parseValidationError} from "../../../assets/utilities/errors"

// Track in-flight requests so we can cancel them by runId
const abortControllers = new Map<string, AbortController>()

const MODELS = ["gemini"]

const extractPromptModel = (variant: EnhancedVariant, requestBody: Record<string, any>) => {
    const candidates = [
        requestBody?.ag_config?.prompt,
        Array.isArray(requestBody?.ag_config?.prompts)
            ? requestBody?.ag_config?.prompts?.[0]
            : undefined,
        variant?.parameters?.ag_config?.prompt,
        variant?.parameters?.prompt,
        (variant?.parameters as any)?.agConfig?.prompt,
    ]

    for (const prompt of candidates) {
        if (!prompt) continue
        const llmCfg = (prompt as any).llm_config || (prompt as any).llmConfig
        if (llmCfg?.model) {
            return llmCfg.model as string
        }
    }
    return undefined
}

const isFileReference = (value: string) => {
    if (!value) return false
    if (/^https?:\/\//i.test(value)) return true
    return value.startsWith("file_") || value.startsWith("file-")
}

const stripFileMetadataForUrlAttachments = (messages: any[]) => {
    messages.forEach((message) => {
        if (!message || !Array.isArray(message.content)) return
        message.content.forEach((part: any) => {
            if (!part || part.type !== "file") return
            const fileNode = part.file || {}
            const fileId = fileNode.file_id || fileNode.fileId
            if (typeof fileId !== "string" || !isFileReference(fileId)) return
            delete fileNode.filename
            delete fileNode.format
        })
    })
}

const applyModelAttachmentRules = (variant: EnhancedVariant, requestBody: Record<string, any>) => {
    if (!requestBody || typeof requestBody !== "object") return
    if (Array.isArray(requestBody.messages)) {
        const modelName = extractPromptModel(variant, requestBody)
        if (modelName && MODELS.some((allowed) => modelName.toLowerCase().includes(allowed))) {
            return
        }
        stripFileMetadataForUrlAttachments(requestBody.messages)
    }
}

async function runVariantInputRow(payload: {
    variant: EnhancedVariant
    allMetadata: Record<string, ConfigMetadata>
    inputRow: GenerationInputRow
    messageRow?: GenerationChatRow
    rowId: string
    appId: string
    uri: {
        runtimePrefix: string
        routePath?: string
        status?: boolean
    }
    headers: Record<string, string>
    projectId: string
    messageId?: string
    chatHistory?: any[]
    spec: OpenAPISpec
    runId: string
    // New: pass pre-resolved prompt context to keep transform consistent with app atoms
    prompts?: any[]
    variables?: string[]
    variableValues?: Record<string, string>
    revisionId?: string
    variantId?: string
    isChat?: boolean
    isCustom?: boolean
    appType?: string
}) {
    const {
        variant,
        rowId,
        uri,
        inputRow,
        messageId,
        messageRow,
        allMetadata,
        headers,
        projectId,
        appId,
        chatHistory,
        spec,
        runId,
        prompts,
        variables,
        variableValues,
        revisionId,
        variantId: payloadVariantId,
        isChat,
        isCustom,
        appType,
    } = payload

    const requestBody = stripAgentaMetadataDeep(
        transformToRequestBody({
            variant,
            inputRow,
            messageRow,
            allMetadata,
            chatHistory,
            spec,
            routePath: uri?.routePath,
            prompts,
            variables,
            variableValues,
            revisionId,
            isChat,
            isCustom,
            appType,
        }),
    )
    applyModelAttachmentRules(variant, requestBody)
    let result
    try {
        // Create an AbortController for this run to support cancellation
        const controller = new AbortController()
        abortControllers.set(runId, controller)
        // Construct URL using the revision's URI info (not localhost)
        const baseUrl = constructPlaygroundTestUrl(uri, "/test", true)
        // The baseUrl should already be absolute if uri.runtimePrefix is properly set
        const fullUrl = baseUrl
        const search = new URLSearchParams()
        search.set("application_id", appId)
        if (headers.Authorization && projectId) {
            search.set("project_id", projectId)
        }
        const queryParams = `?${search.toString()}`

        const response = await fetch(`${fullUrl}${queryParams}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "1",
                ...headers,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) {
            const errorMessage = parseValidationError(data)
            result = {
                response: undefined,
                error: errorMessage,
                metadata: {
                    timestamp: new Date().toISOString(),
                    statusCode: response.status,
                    rawError: data,
                },
            }
        } else {
            result = {
                response: data,
                metadata: {
                    timestamp: new Date().toISOString(),
                    statusCode: response.status,
                },
            }
        }
    } catch (error) {
        console.error("Error running variant input row:", error)
        result = {
            response: undefined,
            error:
                error instanceof Error
                    ? error.name === "AbortError"
                        ? "Request aborted"
                        : error.message
                    : "Unknown error occurred",
            metadata: {
                timestamp: new Date().toISOString(),
                type: "network_error",
            },
        }
    } finally {
        // Cleanup controller for this runId
        abortControllers.delete(runId)
        postMessage({
            type: "runVariantInputRowResult",
            payload: {
                variant,
                variantId: payloadVariantId || revisionId || (variant as any)?.id,
                revisionId,
                rowId,
                result,
                messageId,
                runId,
            },
        })
    }
}

addEventListener(
    "message",
    (
        event: MessageEvent<{
            type: string
            payload: any
        }>,
    ) => {
        if (event.data.type === "ping") {
            postMessage("pong")
        } else if (event.data.type === "runVariantInputRow") {
            runVariantInputRow(event.data.payload)
        } else if (event.data.type === "cancelRun") {
            const {runId} = event.data.payload || {}
            const controller = runId ? abortControllers.get(runId) : undefined
            if (controller) {
                controller.abort()
                abortControllers.delete(runId)
            }
        } else {
            postMessage({
                type: "error",
                payload: "Unknown message",
            })
        }
    },
)
