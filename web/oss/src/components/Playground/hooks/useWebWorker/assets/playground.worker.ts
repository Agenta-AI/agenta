import {GenerationChatRow, GenerationInputRow} from "@/oss/components/Playground/state/types"
import {ConfigMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {constructPlaygroundTestUrl} from "@/oss/lib/shared/variant/stringUtils"
import {OpenAPISpec} from "@/oss/lib/shared/variant/types/openapi"

import {transformToRequestBody} from "../../../../../lib/shared/variant/transformer/transformToRequestBody"
import {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import {parseValidationError} from "../../../assets/utilities/errors"

// Track in-flight requests so we can cancel them by runId
const abortControllers = new Map<string, AbortController>()

const scrubLargeFields = (value: any): any => {
    if (Array.isArray(value)) return value.map((item) => scrubLargeFields(item))
    if (value && typeof value === "object") {
        const next: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(value)) {
            if (typeof val === "string" && val.startsWith("data:")) {
                next[key] = `${val.slice(0, 60)}...(${val.length})`
            } else {
                next[key] = scrubLargeFields(val)
            }
        }
        return next
    }
    return value
}

const logRequestPreview = (body: any) => {
    try {
        const clone = scrubLargeFields(JSON.parse(JSON.stringify(body)))
        // eslint-disable-next-line no-console
        console.log("[Docs][PlaygroundWorker] request body preview", clone)
    } catch (error) {
        // eslint-disable-next-line no-console
        console.log("[Docs][PlaygroundWorker] failed to log request body", error)
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
    const previewPayload = {
        stage: "before-transform",
        messageRow: messageRow ? scrubLargeFields(messageRow) : undefined,
        chatHistory: chatHistory ? scrubLargeFields(chatHistory) : undefined,
    }
    logRequestPreview(previewPayload)
    if (Array.isArray(chatHistory)) {
        chatHistory.forEach((entry, idx) => {
            // eslint-disable-next-line no-console
            console.log("[Docs][PlaygroundWorker] chatHistory entry", {
                idx,
                entry: scrubLargeFields(entry),
            })
        })
    }
    if (messageRow?.history?.value) {
        const rawHistory = messageRow.history.value
        if (Array.isArray(rawHistory)) {
            rawHistory.forEach((entry: any, idx: number) => {
                // eslint-disable-next-line no-console
                console.log("[Docs][PlaygroundWorker] raw history entry", {
                    idx,
                    entry: scrubLargeFields(entry),
                })
            })
        }
    }

    const requestBody = transformToRequestBody({
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
    })
    logRequestPreview(requestBody)
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
